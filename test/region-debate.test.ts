// test/region-debate.test.ts
import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { makeRegionReviewer } from '../src/agents/region-reviewer';
import { StubModelClient } from '../src/models/client';
import { loadBrandDna, loadRulebook } from '../src/domain/load';

const ASSETS = new URL('../assets/', import.meta.url).pathname;
const challenge = JSON.stringify({ kind: 'challenge', claim: 'boost', peerRegion: 'US', peerRationale: 'substantiated by RCT' });

describe('region reviewer debate', () => {
  it('answers a peer challenge with a hold/concede rebuttal addressed to the pod lead', async () => {
    const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
    const eu = loadRulebook(`${ASSETS}rulebook.eu.json`);
    const model = new StubModelClient(() => ({ text: '', json: { stance: 'hold', rationale: 'Article 10(2) still applies' } }));
    const room = new FakeBandTransport('r');
    await room.connectAgent({ agentId: 'lead', name: 'Reg Lead', handle: '@reg-lead', onMessage: async () => {} });
    await room.connectAgent({
      agentId: 'eu', name: 'EU Reviewer', handle: '@eu-reviewer',
      onMessage: makeRegionReviewer({ region: 'EU', reviewerName: 'EU Reviewer', rulebook: eu, brand, model, reportToHandle: '@reg-lead' }),
    });
    room.post('lead', challenge, [{ id: 'eu' }]);
    await room.drain();
    const reply = room.transcript.find((t) => t.fromId === 'eu' && t.kind === 'message');
    const payload = JSON.parse(reply!.content);
    expect(payload.kind).toBe('rebuttal');
    expect(payload.region).toBe('EU');
    expect(payload.stance).toBe('hold');
  });
});
