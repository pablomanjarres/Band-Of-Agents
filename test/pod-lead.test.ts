// test/pod-lead.test.ts
import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { makePodLead } from '../src/agents/pod-lead';

const review = (region: string, severity: 'block' | 'warn' | 'info', claim = 'boost') =>
  JSON.stringify({ region, reviewer: `${region} Reviewer`, findings: [{ category: 'claim', severity, claim, rationale: 'r' }] });

describe('pod lead', () => {
  it('files one PodFinding to the adjudicator once all members report, flagging the cross-region conflict', async () => {
    const room = new FakeBandTransport('r');
    const filed: string[] = [];
    await room.connectAgent({ agentId: 'adj', name: 'Adjudicator', handle: '@adjudicator', onMessage: async (m) => { filed.push(m.content); } });
    await room.connectAgent({
      agentId: 'lead', name: 'Reg Lead', handle: '@reg-lead',
      onMessage: makePodLead({ pod: 'regulatory', members: ['@us-reviewer', '@eu-reviewer'], memberKeys: ['US', 'EU'], reportToHandle: '@adjudicator', debate: false }),
    });
    // US passes (info), EU blocks the same span -> conflict
    room.post('us', review('US', 'info'), [{ id: 'lead' }]);
    room.post('eu', review('EU', 'block'), [{ id: 'lead' }]);
    await room.drain();
    expect(filed).toHaveLength(1);
    const pf = JSON.parse(filed[0]!);
    expect(pf.kind).toBe('pod-finding');
    expect(pf.pod).toBe('regulatory');
    expect(pf.conflicts[0].span).toBe('boost');
    expect(pf.conflicts[0].blockedBy).toContain('EU');
    expect(pf.conflicts[0].passedBy).toContain('US');
  });
});
