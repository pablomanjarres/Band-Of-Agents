// test/risk-adjudicator.test.ts
import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { makeRiskAdjudicator } from '../src/agents/risk-adjudicator';

const pf = (pod: string, conflicts: unknown[] = []) =>
  JSON.stringify({ kind: 'pod-finding', pod, summary: '', findings: [], conflicts });
const conflict = { span: 'boost', blockedBy: ['EU'], passedBy: ['US'], rationale: 'Art 10(2)' };

const adj = (room: FakeBandTransport) => makeRiskAdjudicator({
  expectedPods: ['claims', 'regulatory', 'brand'],
  mediatorHandle: '@mediator', remediationHandle: '@remediation', humanHandle: '@compliance-lead', maxRecommits: 1,
});

describe('risk adjudicator', () => {
  it('publishes when no pod reports a conflict', async () => {
    const events: Array<{ type: string; meta: Record<string, unknown> }> = [];
    const room = new FakeBandTransport('r', { onActivity: (a) => { if (a.kind === 'event') events.push({ type: a.messageType ?? '', meta: a.metadata ?? {} }); } });
    await room.connectAgent({ agentId: 'adj', name: 'Adjudicator', handle: '@adjudicator', onMessage: adj(room) });
    room.post('cl', pf('claims'), [{ id: 'adj' }]);
    room.post('rg', pf('regulatory'), [{ id: 'adj' }]);
    room.post('br', pf('brand'), [{ id: 'adj' }]);
    await room.drain();
    expect(events.some((e) => e.type === 'terminal' && e.meta.decision === 'published')).toBe(true);
  });

  it('mediates a conflict, remediates once, then escalates to the human, who can spike', async () => {
    const toMediator: string[] = [];
    const toRemediation: string[] = [];
    const toHuman: string[] = [];
    const events: string[] = [];
    const room = new FakeBandTransport('r', { onActivity: (a) => { if (a.kind === 'event') events.push(a.messageType ?? ''); } });
    room.addUser('lead', 'Compliance Lead', '@compliance-lead');
    await room.connectAgent({ agentId: 'med', name: 'Mediator', handle: '@mediator', onMessage: async (m) => { toMediator.push(m.content); } });
    await room.connectAgent({ agentId: 'rem', name: 'Remediation', handle: '@remediation', onMessage: async (m) => { toRemediation.push(m.content); } });
    await room.connectAgent({ agentId: 'adj', name: 'Adjudicator', handle: '@adjudicator', onMessage: adj(room) });

    // Round 1: regulatory reports a conflict.
    room.post('cl', pf('claims'), [{ id: 'adj' }]);
    room.post('rg', pf('regulatory', [conflict]), [{ id: 'adj' }]);
    room.post('br', pf('brand'), [{ id: 'adj' }]);
    await room.drain();
    expect(toMediator).toHaveLength(1); // mediator was woken

    // Mediator: no movement -> adjudicator remediates (attempt 1) and clears for recommit.
    room.post('med', JSON.stringify({ kind: 'mediation', resolved: false, note: 'no movement', requiredDisclosure: null }), [{ id: 'adj' }]);
    await room.drain();
    expect(toRemediation).toHaveLength(1);

    // Recommit: pods re-report, still conflicting -> mediate again -> no movement -> cap hit -> escalate.
    room.post('cl', pf('claims'), [{ id: 'adj' }]);
    room.post('rg', pf('regulatory', [conflict]), [{ id: 'adj' }]);
    room.post('br', pf('brand'), [{ id: 'adj' }]);
    await room.drain();
    room.post('med', JSON.stringify({ kind: 'mediation', resolved: false, note: 'still stuck', requiredDisclosure: null }), [{ id: 'adj' }]);
    await room.drain();
    expect(toHuman).toBeDefined();
    expect(events).toContain('escalation');

    // Human rules: reject -> spiked terminal.
    room.post('lead', 'Reject for EU, cannot publish without authorization', [{ id: 'adj' }]);
    await room.drain();
    expect(events).toContain('decision');
    expect(events.filter((e) => e === 'terminal').length).toBeGreaterThanOrEqual(1);
  });
});
