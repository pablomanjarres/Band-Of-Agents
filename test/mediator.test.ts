// test/mediator.test.ts
import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { makeMediator } from '../src/agents/mediator';
import { StubModelClient } from '../src/models/client';

const mediate = JSON.stringify({
  kind: 'mediate',
  conflicts: [{ span: 'boost', blockedBy: ['EU'], passedBy: ['US'], rationale: 'Article 10(2)' }],
});

describe('mediator', () => {
  it('posts a MediationResult addressed to the adjudicator', async () => {
    const model = new StubModelClient(() => ({ text: '', json: { resolved: false, note: 'EU will not move without authorization', requiredDisclosure: null } }));
    const got: string[] = [];
    const room = new FakeBandTransport('r');
    await room.connectAgent({ agentId: 'adj', name: 'Adjudicator', handle: '@adjudicator', onMessage: async (m) => { got.push(m.content); } });
    await room.connectAgent({ agentId: 'med', name: 'Mediator', handle: '@mediator', onMessage: makeMediator({ model, reportToHandle: '@adjudicator' }) });
    room.post('adj', mediate, [{ id: 'med' }]);
    await room.drain();
    const payload = JSON.parse(got[0]!);
    expect(payload.kind).toBe('mediation');
    expect(payload.resolved).toBe(false);
    expect(payload.note).toContain('authorization');
  });
});
