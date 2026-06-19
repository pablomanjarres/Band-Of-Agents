// src/agents/pod-lead.ts
import type { AgentHandler, Participant, RoomTools } from '../band/types';
import type { ContentAsset, Finding } from '../domain/types';
import type { ModelClient } from '../models/client';
import type { ConflictItem, PodFinding } from '../domain/board';
import type { PodHub } from '../board/pod-hub';
import { findParticipant, matchParticipant } from './handles';
import { tryParseAsset } from '../domain/load';

export interface PodLeadOptions {
  pod: 'claims' | 'regulatory' | 'brand';
  members: string[];        // member handles to dispatch the asset to
  memberKeys: string[];     // expected reply keys (region or source) to wait for
  reportToHandle: string;   // '@adjudicator'
  debate?: boolean;         // run a one-round rebuttal when a conflict is detected
  hub?: PodHub;             // when set, read the asset from the hub and dispatch plain English
  /**
   * Solo mode: the pod has no members. Instead of recruiting, the lead reviews the
   * asset itself in one model call and files the pod finding. Used to compress a pod
   * (e.g. Claims, Brand) down to a single agent for a smaller Band.ai room.
   */
  solo?: { model: ModelClient; system: string; jsonSchema: unknown };
}

interface MemberReply { key: string; findings: Finding[] }

export function makePodLead(opts: PodLeadOptions): AgentHandler {
  // Per-room accumulation, mirroring makeReconcile's collected-Map pattern.
  const replies = new Map<string, Map<string, MemberReply>>();
  const debated = new Set<string>();
  // Reply keys actually expected per room: only the members present when the asset
  // arrived, so the pod adapts to a partial roster (e.g. band.ai's 14-agent room
  // cap) instead of waiting forever for an absent member.
  const expectedKeys = new Map<string, string[]>();
  // band.ai delivery is at-most-once: it can DROP a present member's reply message,
  // which would hang haveAll forever. A per-room fallback timer consolidates from the
  // hub (where reviewers write their findings directly) even if a reply message never
  // lands, so the pod always files and the review concludes.
  const fallbackTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const POD_FALLBACK_MS = Number(process.env.POD_FALLBACK_MS ?? 40000);

  const detectConflicts = (all: MemberReply[], keys: string[]): ConflictItem[] => {
    const byClaim = new Map<string, { blockedBy: string[]; passedBy: string[]; rationale: string }>();
    for (const r of all) {
      const blockedClaims = new Set(r.findings.filter((f) => f.severity === 'block').map((f) => f.claim));
      const seen = new Set<string>();
      for (const f of r.findings) {
        if (seen.has(f.claim)) continue;
        seen.add(f.claim);
        const entry = byClaim.get(f.claim) ?? { blockedBy: [], passedBy: [], rationale: '' };
        if (blockedClaims.has(f.claim)) { entry.blockedBy.push(r.key); entry.rationale = f.rationale; }
        else entry.passedBy.push(r.key);
        byClaim.set(f.claim, entry);
      }
      // Members with no finding on a blocked claim count as passing it.
    }
    // A claim blocked by some members and not by others is a conflict.
    const conflicts: ConflictItem[] = [];
    for (const [span, e] of byClaim) {
      const passedBy = keys.filter((k) => !e.blockedBy.includes(k));
      if (e.blockedBy.length > 0 && passedBy.length > 0) {
        conflicts.push({ span, blockedBy: e.blockedBy, passedBy, rationale: e.rationale });
      }
    }
    return conflicts;
  };

  const consolidateAndFile = async (roomId: string, tools: RoomTools, participants: Participant[]): Promise<void> => {
    const map = replies.get(roomId);
    if (!map) return;
    const keys = expectedKeys.get(roomId) ?? opts.memberKeys;
    // Recover a dropped member's findings from the hub (reviewers write there directly),
    // so a lost reply message does not lose that region's findings.
    const all = keys
      .map((k) => map.get(k) ?? (opts.hub ? { key: k, findings: opts.hub.finding(roomId, k) ?? [] } : undefined))
      .filter((r): r is MemberReply => Boolean(r));
    const findings = all.flatMap((r) => r.findings);
    const conflicts = detectConflicts(all, keys);
    const pf: PodFinding = {
      kind: 'pod-finding',
      pod: opts.pod,
      summary: `${opts.pod} pod: ${findings.length} findings, ${conflicts.length} conflict(s)`,
      findings,
      conflicts,
    };
    await tools.sendEvent(pf.summary, 'pod-finding', { pod: opts.pod, conflicts: conflicts.length });
    const target = matchParticipant(participants, opts.reportToHandle, 'agent');
    if (target) {
      if (opts.hub) {
        opts.hub.setPodFinding(roomId, opts.pod, pf);
        await tools.sendMessage(`${opts.pod} pod filed: ${findings.length} finding(s), ${conflicts.length} conflict(s).`, [{ id: target.id, handle: target.handle }]);
      } else {
        await tools.sendMessage(JSON.stringify(pf), [{ id: target.id, handle: target.handle }]);
      }
    }
    replies.delete(roomId);
    debated.delete(roomId);
    expectedKeys.delete(roomId);
    const timer = fallbackTimers.get(roomId);
    if (timer) { clearTimeout(timer); fallbackTimers.delete(roomId); }
  };

  // Solo mode: the lead reviews the asset itself (one model call) and files the pod
  // finding, with no members. Graceful on a model error so the spine still gets a
  // finding and the review concludes.
  const reviewSoloAndFile = async (roomId: string, tools: RoomTools, participants: Participant[], asset: ContentAsset): Promise<void> => {
    await tools.sendEvent(`${opts.pod} pod reviewing`, 'recruited', { pod: opts.pod });
    let findings: Finding[] = [];
    try {
      const res = await opts.solo!.model.complete({
        system: opts.solo!.system,
        messages: [{ role: 'user', content: `Asset (JSON):\n${JSON.stringify(asset, null, 2)}` }],
        jsonSchema: opts.solo!.jsonSchema,
      });
      const payload = res.json && typeof res.json === 'object' ? (res.json as Record<string, unknown>) : {};
      findings = (Array.isArray(payload['findings']) ? payload['findings'] : []) as Finding[];
    } catch (err) {
      console.warn(`[${opts.pod}] solo review failed (continuing):`, (err as Error)?.message ?? err);
    }
    const pf: PodFinding = {
      kind: 'pod-finding',
      pod: opts.pod,
      summary: `${opts.pod} pod: ${findings.length} findings, 0 conflict(s)`,
      findings,
      conflicts: [],
    };
    if (opts.hub) opts.hub.setFinding(roomId, opts.pod, findings);
    await tools.sendEvent(pf.summary, 'pod-finding', { pod: opts.pod, conflicts: 0 });
    const target = matchParticipant(participants, opts.reportToHandle, 'agent');
    if (!target) return;
    if (opts.hub) {
      opts.hub.setPodFinding(roomId, opts.pod, pf);
      await tools.sendMessage(`${opts.pod} pod filed: ${findings.length} finding(s), 0 conflict(s). The Adjudicator will post the full report with a link.`, [{ id: target.id, handle: target.handle }]);
    } else {
      await tools.sendMessage(JSON.stringify(pf), [{ id: target.id, handle: target.handle }]);
    }
  };

  return async (message, tools) => {
    const roomId = message.roomId;
    const participants = await tools.getParticipants();

    // A member reply is JSON keyed by source/region (back-compat) or, in prose mode,
    // any message whose sender is one of our members. The asset carries neither.
    let body: Record<string, unknown> | null = null;
    try { body = JSON.parse(message.content); } catch { body = null; }
    const isContentReply = !!body && (typeof body.source === 'string' || typeof body.region === 'string' || body.kind === 'rebuttal');
    let senderKey = '';
    if (!isContentReply) {
      const idx = opts.members.findIndex((h) => { const p = findParticipant(participants, h, 'agent'); return !!p && p.id === message.senderId; });
      if (idx >= 0) senderKey = opts.memberKeys[idx]!;
    }
    const isMemberReply = isContentReply || senderKey !== '';

    // 1) Start: dispatch the asset to the members present in the room.
    if (!isMemberReply) {
      const asset = tryParseAsset(message.content) ?? opts.hub?.asset(roomId);
      if (!asset) return;
      // Solo pod: review the asset directly and file, with no member recruitment.
      if (opts.solo) {
        await reviewSoloAndFile(roomId, tools, participants, asset);
        return;
      }
      replies.set(roomId, new Map());
      const present: string[] = [];
      const mentions: Array<{ id: string; handle: string }> = [];
      for (let i = 0; i < opts.members.length; i++) {
        const t = findParticipant(participants, opts.members[i]!, 'agent');
        if (!t) continue;
        present.push(opts.memberKeys[i]!);
        mentions.push({ id: t.id, handle: t.handle });
      }
      // One message mentioning every present member, not one each.
      if (mentions.length) {
        const dispatch = opts.hub ? `Please review the "${asset.name ?? asset.id}" campaign.` : JSON.stringify(asset);
        await tools.sendMessage(dispatch, mentions);
      }
      expectedKeys.set(roomId, present);
      await tools.sendEvent(`${opts.pod} pod deliberating (${present.length} members)`, 'recruited', { pod: opts.pod });
      // Arm the fallback: if a member's reply message is dropped, consolidate from the
      // hub after a timeout so the pod never hangs. Cleared when all replies arrive.
      if (present.length > 0) {
        const prev = fallbackTimers.get(roomId);
        if (prev) clearTimeout(prev);
        fallbackTimers.set(roomId, setTimeout(() => {
          fallbackTimers.delete(roomId);
          void consolidateAndFile(roomId, tools, participants).catch(() => { /* best effort */ });
        }, POD_FALLBACK_MS));
      }
      // A pod with no members present files an empty finding at once so the spine still gets it.
      if (present.length === 0) await consolidateAndFile(roomId, tools, participants);
      return;
    }

    // 2) A member reply (review result or rebuttal).
    const map = replies.get(roomId) ?? new Map<string, MemberReply>();
    replies.set(roomId, map);

    if (isContentReply && body!.kind === 'rebuttal') {
      const key = String(body!.region ?? '');
      const prev = map.get(key);
      // concede drops the block to a warn so it no longer conflicts.
      if (prev && body!.stance === 'concede') {
        prev.findings = prev.findings.map((f) => (f.claim === body!.claim && f.severity === 'block' ? { ...f, severity: 'warn' as const } : f));
      }
      map.set(`${key}:rebut`, { key: `${key}:rebut`, findings: [] }); // mark received
    } else {
      // Initial review, or a prose rebuttal (the reviewer already updated its hub finding).
      const key = isContentReply ? String(body!.region ?? body!.source ?? '') : senderKey;
      const findings = isContentReply
        ? ((Array.isArray(body!.findings) ? body!.findings : []) as Finding[])
        : (opts.hub?.finding(roomId, key) ?? []);
      map.set(key, { key, findings });
    }

    // 3) All present members in?
    const keys = expectedKeys.get(roomId) ?? opts.memberKeys;
    const haveAll = keys.every((k) => map.has(k));
    if (!haveAll) return;

    const initial = keys.map((k) => map.get(k)).filter((r): r is MemberReply => Boolean(r));
    const conflicts = detectConflicts(initial, keys);

    // 4) Optional one rebuttal round on conflict.
    if (opts.debate && conflicts.length > 0 && !debated.has(roomId)) {
      debated.add(roomId);
      for (const c of conflicts) {
        for (const region of c.blockedBy) {
          const handle = `@${region.toLowerCase()}-reviewer`;
          const t = findParticipant(participants, handle, 'agent');
          if (!t) continue;
          if (opts.hub) {
            opts.hub.setChallenge(roomId, region, { claim: c.span, peerRegion: c.passedBy[0] ?? '', peerRationale: 'a peer passes this span' });
            await tools.sendMessage(`${region} reviewer, ${c.passedBy[0] ?? 'a peer'} passes "${c.span}". Hold your block or concede?`, [{ id: t.id, handle: t.handle }]);
          } else {
            await tools.sendMessage(JSON.stringify({ kind: 'challenge', claim: c.span, peerRegion: c.passedBy[0], peerRationale: 'peer passes this span' }), [{ id: t.id, handle: t.handle }]);
          }
        }
      }
      return; // wait for rebuttals, then this handler re-fires and re-evaluates
    }

    // 5) Consolidate and file.
    await consolidateAndFile(roomId, tools, participants);
  };
}
