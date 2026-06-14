// src/agents/pod-lead.ts
import type { AgentHandler, RoomTools } from '../band/types';
import type { Finding } from '../domain/types';
import type { ConflictItem, PodFinding } from '../domain/board';
import { matchParticipant } from './handles';
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

  const detectConflicts = (all: MemberReply[]): ConflictItem[] => {
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
      const passedBy = opts.memberKeys.filter((k) => !e.blockedBy.includes(k));
      if (e.blockedBy.length > 0 && passedBy.length > 0) {
        conflicts.push({ span, blockedBy: e.blockedBy, passedBy, rationale: e.rationale });
      }
    }
    return conflicts;
  };

  const consolidateAndFile = async (roomId: string, tools: RoomTools): Promise<void> => {
    const map = replies.get(roomId);
    if (!map) return;
    const all = [...map.values()];
    const findings = all.flatMap((r) => r.findings);
    const conflicts = detectConflicts(all);
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
  };

  return async (message, tools) => {
    const roomId = message.roomId;

    // 1) Asset from the conductor: dispatch to members.
    const asset = tryParseAsset(message.content);
    if (asset) {
      replies.set(roomId, new Map());
      const participants = await tools.getParticipants();
      for (const handle of opts.members) {
        const t = matchParticipant(participants, handle, 'agent');
        if (t) await tools.sendMessage(JSON.stringify(asset), [{ id: t.id, handle: t.handle }]);
      }
      await tools.sendEvent(`${opts.pod} pod deliberating (${opts.members.length} members)`, 'recruited', { pod: opts.pod });
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

    // 3) All initial members in?
    const haveAll = opts.memberKeys.every((k) => map.has(k));
    if (!haveAll) return;

    const initial = opts.memberKeys.map((k) => map.get(k)!).filter(Boolean);
    const conflicts = detectConflicts(initial);

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
