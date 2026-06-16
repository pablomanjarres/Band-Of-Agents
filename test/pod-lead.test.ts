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

  it('adapts to a partial roster: files once present members report, without waiting for absent ones', async () => {
    const room = new FakeBandTransport('r');
    const filed: string[] = [];
    await room.connectAgent({ agentId: 'adj', name: 'Adjudicator', handle: '@adjudicator', onMessage: async (m) => { filed.push(m.content); } });
    await room.connectAgent({
      agentId: 'lead', name: 'Claims Lead', handle: '@claims-lead',
      onMessage: makePodLead({ pod: 'claims', members: ['@scout', '@claim-evidence', '@precedent', '@disclosure'], memberKeys: ['scout', 'claim-evidence', 'precedent', 'disclosure'], reportToHandle: '@adjudicator', debate: false }),
    });
    // Only claim-evidence and disclosure are in the room (scout + precedent absent, e.g. a 14-agent cap).
    await room.connectAgent({ agentId: 'ce', name: 'Claim & Evidence', handle: '@claim-evidence', onMessage: async () => {} });
    await room.connectAgent({ agentId: 'disc', name: 'Disclosure', handle: '@disclosure', onMessage: async () => {} });

    room.post('cond', JSON.stringify({ id: 'a1', channel: 'instagram', markets: ['US'], copy: 'c', claim: 'boost' }), [{ id: 'lead' }]);
    await room.drain();
    expect(filed).toHaveLength(0); // waiting only for the two present members

    room.post('ce', JSON.stringify({ source: 'claim-evidence', findings: [{ category: 'claim', severity: 'warn', claim: 'boost', rationale: 'needs a source' }] }), [{ id: 'lead' }]);
    room.post('disc', JSON.stringify({ source: 'disclosure', findings: [] }), [{ id: 'lead' }]);
    await room.drain();
    expect(filed).toHaveLength(1); // filed without scout/precedent
    expect(JSON.parse(filed[0]!).pod).toBe('claims');
  });
});
