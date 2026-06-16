// src/agents/risk-adjudicator.ts
import type { AgentHandler, RoomTools } from '../band/types';
import type { PodFinding, ConflictItem, MediationResult } from '../domain/board';
import type { PodHub } from '../board/pod-hub';
import { matchParticipant } from './handles';

export interface RiskAdjudicatorOptions {
  expectedPods: Array<'claims' | 'regulatory' | 'brand'>;
  mediatorHandle: string;     // '@mediator'
  remediationHandle: string;  // '@remediation'
  humanHandle: string;        // '@compliance-lead'
  maxRecommits?: number;      // default 1
  logPrecedent?: (p: { claim: string; decision: string; note: string }) => void;
  hub?: PodHub;               // when set, read pod findings/mediation from the hub (prose on the wire)
}

interface RoomState {
  pods: Map<string, PodFinding>;
  mediation?: MediationResult;
  recommits: number;
  mediateRequested: boolean;
}

export function makeRiskAdjudicator(opts: RiskAdjudicatorOptions): AgentHandler {
  const max = opts.maxRecommits ?? 1;
  const rooms = new Map<string, RoomState>();
  const stateFor = (id: string): RoomState => {
    let s = rooms.get(id);
    if (!s) { s = { pods: new Map(), recommits: 0, mediateRequested: false }; rooms.set(id, s); }
    return s;
  };
  const conflictsOf = (s: RoomState): ConflictItem[] => [...s.pods.values()].flatMap((p) => p.conflicts ?? []);

  const decide = async (roomId: string, tools: RoomTools): Promise<void> => {
    const s = stateFor(roomId);
    const conflicts = conflictsOf(s);

    if (conflicts.length > 0 && !s.mediateRequested) {
      s.mediateRequested = true;
      const t = matchParticipant(await tools.getParticipants(), opts.mediatorHandle, 'agent');
      await tools.sendEvent(`Adjudicator: ${conflicts.length} conflict(s), consulting mediator`, 'adjudication', { decision: 'mediate' });
      opts.hub?.setConflicts(roomId, conflicts);
      if (t) await tools.sendMessage(opts.hub ? `${conflicts.length} cross-pod conflict(s). Mediator, can these be resolved?` : JSON.stringify({ kind: 'mediate', conflicts }), [{ id: t.id, handle: t.handle }]);
      return;
    }

    const resolved = conflicts.length === 0 || (s.mediation?.resolved ?? false);
    if (resolved) {
      await tools.sendEvent('Adjudicator: publishable', 'adjudication', { decision: 'publish', score: 1 });
      await tools.sendEvent('PUBLISHED', 'terminal', { decision: 'published' });
      await tools.sendEvent('done', 'status', { status: 'complete' });
      rooms.delete(roomId);
      return;
    }

    // After the publishable return, conflicts is non-empty (resolved covers the empty case).
    const c = conflicts[0];
    if (!c) return;

    if (s.recommits < max) {
      s.recommits += 1;
      await tools.sendEvent(`Adjudicator: remediate (attempt ${s.recommits})`, 'adjudication', { decision: 'remediate', score: 0.5 });
      opts.hub?.setConflicts(roomId, conflicts);
      const t = matchParticipant(await tools.getParticipants(), opts.remediationHandle, 'agent');
      if (t) await tools.sendMessage(opts.hub ? `Remediation, please revise the ${c.blockedBy[0] ?? 'EU'} copy for the block on "${c.span}" and re-submit.` : JSON.stringify({ kind: 'remediation', region: c.blockedBy[0] ?? 'EU', findings: [{ category: 'claim', severity: 'block', claim: c.span, rationale: c.rationale }] }), [{ id: t.id, handle: t.handle }]);
      s.pods.clear(); s.mediation = undefined; s.mediateRequested = false;
      return;
    }

    // Cap reached -> escalate to the human.
    await tools.sendEvent('Adjudicator: deadlock, escalating', 'adjudication', { decision: 'escalate', score: 0.1 });
    await tools.sendEvent(`Escalation: unresolved conflict on "${c.span}"`, 'escalation', {});
    await tools.sendEvent('awaiting human', 'status', { status: 'awaiting-decision' });
    const t = matchParticipant(await tools.getParticipants(), opts.humanHandle, 'user');
    if (t) await tools.sendMessage(`@compliance-lead deadlock on "${c.span}". Publish with disclosure, or reject?`, [{ id: t.id, handle: t.handle }]);
  };

  return async (message, tools) => {
    const roomId = message.roomId;
    const s = stateFor(roomId);
    let body: Record<string, unknown> | null = null;
    try { body = JSON.parse(message.content); } catch { body = null; }

    // Human ruling: plain text from the compliance lead.
    if (message.senderType === 'user' && !body) {
      const reject = /reject|spike|kill|do not|cannot/i.test(message.content);
      const decision = reject ? 'spiked' : 'published';
      opts.logPrecedent?.({ claim: conflictsOf(s)[0]?.span ?? '', decision, note: message.content });
      await tools.sendEvent(`Human ruling: ${decision}`, 'decision', { decision });
      await tools.sendEvent(decision === 'spiked' ? 'SPIKED' : 'PUBLISHED', 'terminal', { decision });
      await tools.sendEvent('done', 'status', { status: 'complete' });
      rooms.delete(roomId);
      return;
    }

    // A pod filed its finding: JSON (back-compat) or prose from a lead (read the hub).
    let pod = body?.kind === 'pod-finding' ? String(body.pod) : '';
    let pf: PodFinding | undefined = body?.kind === 'pod-finding' ? (body as unknown as PodFinding) : undefined;
    if (!pf && opts.hub && message.senderType === 'agent') {
      const sn = (message.senderName ?? '').toLowerCase();
      const resolved = sn.includes('claim') ? 'claims' : sn.includes('reg') ? 'regulatory' : sn.includes('brand') ? 'brand' : '';
      if (resolved) { pf = opts.hub.podFinding(roomId, resolved); pod = resolved; }
    }
    if (pf) {
      s.pods.set(pod, pf);
      if (opts.expectedPods.every((p) => s.pods.has(p))) await decide(roomId, tools);
      return;
    }

    // The mediator reported back: JSON or prose (read the hub).
    let mediation: MediationResult | undefined = body?.kind === 'mediation' ? (body as unknown as MediationResult) : undefined;
    if (!mediation && opts.hub && (message.senderName ?? '').toLowerCase().includes('mediator')) mediation = opts.hub.mediation(roomId);
    if (mediation) {
      s.mediation = mediation;
      await decide(roomId, tools);
    }
  };
}
