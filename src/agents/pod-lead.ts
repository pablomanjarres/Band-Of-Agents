// src/agents/pod-lead.ts
import type { AgentHandler, RoomTools } from '../band/types';
import type { Finding } from '../domain/types';
import type { ConflictItem, PodFinding } from '../domain/board';
import { findParticipant, matchParticipant } from './handles';
import { tryParseAsset } from '../domain/load';

export interface PodLeadOptions {
  pod: 'claims' | 'regulatory' | 'brand';
  members: string[];        // member handles to dispatch the asset to
  memberKeys: string[];     // expected reply keys (region or source) to wait for
  reportToHandle: string;   // '@adjudicator'
  debate?: boolean;         // run a one-round rebuttal when a conflict is detected
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

  const consolidateAndFile = async (roomId: string, tools: RoomTools): Promise<void> => {
    const map = replies.get(roomId);
    if (!map) return;
    const keys = expectedKeys.get(roomId) ?? opts.memberKeys;
    const all = keys.map((k) => map.get(k)).filter((r): r is MemberReply => Boolean(r));
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
    const target = matchParticipant(await tools.getParticipants(), opts.reportToHandle, 'agent');
    if (target) await tools.sendMessage(JSON.stringify(pf), [{ id: target.id, handle: target.handle }]);
    replies.delete(roomId);
    debated.delete(roomId);
    expectedKeys.delete(roomId);
  };

  return async (message, tools) => {
    const roomId = message.roomId;

    // 1) Asset from the conductor: dispatch to members.
    const asset = tryParseAsset(message.content);
    if (asset) {
      replies.set(roomId, new Map());
      const participants = await tools.getParticipants();
      const present: string[] = [];
      for (let i = 0; i < opts.members.length; i++) {
        const t = findParticipant(participants, opts.members[i]!, 'agent');
        if (!t) continue;
        present.push(opts.memberKeys[i]!);
        await tools.sendMessage(JSON.stringify(asset), [{ id: t.id, handle: t.handle }]);
      }
      expectedKeys.set(roomId, present);
      await tools.sendEvent(`${opts.pod} pod deliberating (${present.length} members)`, 'recruited', { pod: opts.pod });
      // A pod with no members present files an empty finding at once so the spine still gets it.
      if (present.length === 0) await consolidateAndFile(roomId, tools);
      return;
    }

    // 2) A member reply (review result, rebuttal) or noise.
    let body: Record<string, unknown> | null = null;
    try { body = JSON.parse(message.content); } catch { return; }
    if (!body) return;

    const map = replies.get(roomId) ?? new Map<string, MemberReply>();
    replies.set(roomId, map);

    if (body.kind === 'rebuttal') {
      const key = String(body.region ?? '');
      const prev = map.get(key);
      // concede drops the block to a warn so it no longer conflicts.
      if (prev && body.stance === 'concede') {
        prev.findings = prev.findings.map((f) => (f.claim === body.claim && f.severity === 'block' ? { ...f, severity: 'warn' as const } : f));
      }
      map.set(`${key}:rebut`, { key: `${key}:rebut`, findings: [] }); // mark received
    } else {
      const key = String(body.region ?? body.source ?? '');
      const findings = (Array.isArray(body.findings) ? body.findings : []) as Finding[];
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
      const participants = await tools.getParticipants();
      for (const c of conflicts) {
        for (const region of c.blockedBy) {
          const handle = `@${region.toLowerCase()}-reviewer`;
          const t = matchParticipant(participants, handle, 'agent');
          if (t) await tools.sendMessage(JSON.stringify({ kind: 'challenge', claim: c.span, peerRegion: c.passedBy[0], peerRationale: 'peer passes this span' }), [{ id: t.id, handle: t.handle }]);
        }
      }
      return; // wait for rebuttals, then this handler re-fires and re-evaluates
    }

    // 5) Consolidate and file.
    await consolidateAndFile(roomId, tools);
  };
}
