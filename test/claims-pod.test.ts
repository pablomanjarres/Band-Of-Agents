// test/claims-pod.test.ts
import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { makePodLead } from '../src/agents/pod-lead';
import { makeScout, makeClaimEvidence, makePrecedent, makeDisclosure } from '../src/agents/pod-members';
import { StubModelClient } from '../src/models/client';
import { loadAsset } from '../src/domain/load';

const ASSETS = new URL('../assets/', import.meta.url).pathname;

describe('claims pod', () => {
  it('files one claims PodFinding carrying the unsupported-claim finding', async () => {
    const asset = loadAsset(`${ASSETS}sample-asset.json`);
    const scout = new StubModelClient(() => ({ text: '', json: { workItems: [{ id: 'w1', kind: 'claim', text: asset.claim, surfaces: ['headline'] }] } }));
    const ce = new StubModelClient(() => ({ text: '', json: { findings: [{ category: 'claim', severity: 'warn', claim: asset.claim, rationale: 'needs a source' }] } }));
    const prec = new StubModelClient(() => ({ text: '', json: { findings: [] } }));
    const disc = new StubModelClient(() => ({ text: '', json: { findings: [] } }));

    const filed: string[] = [];
    const room = new FakeBandTransport('r');
    await room.connectAgent({ agentId: 'adj', name: 'Adjudicator', handle: '@adjudicator', onMessage: async (m) => { filed.push(m.content); } });
    await room.connectAgent({ agentId: 'lead', name: 'Claims Lead', handle: '@claims-lead', onMessage: makePodLead({ pod: 'claims', members: ['@scout', '@claim-evidence', '@precedent', '@disclosure'], memberKeys: ['scout', 'claim-evidence', 'precedent', 'disclosure'], reportToHandle: '@adjudicator', debate: false }) });
    await room.connectAgent({ agentId: 'scout', name: 'Scout', handle: '@scout', onMessage: makeScout(scout) });
    await room.connectAgent({ agentId: 'ce', name: 'Claim & Evidence', handle: '@claim-evidence', onMessage: makeClaimEvidence(ce) });
    await room.connectAgent({ agentId: 'prec', name: 'Precedent', handle: '@precedent', onMessage: makePrecedent(prec) });
    await room.connectAgent({ agentId: 'disc', name: 'Disclosure', handle: '@disclosure', onMessage: makeDisclosure(disc) });

    room.post('cond', JSON.stringify(asset), [{ id: 'lead' }]);
    await room.drain();

    expect(filed).toHaveLength(1);
    const pf = JSON.parse(filed[0]!);
    expect(pf.pod).toBe('claims');
    expect(pf.findings.some((f: { rationale: string }) => f.rationale.includes('source'))).toBe(true);
    expect(pf.conflicts).toEqual([]);
  });
});
