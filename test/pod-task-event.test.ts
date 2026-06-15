import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { makeRegionReviewer } from '../src/agents/pod-region-reviewer';
import { StubModelClient } from '../src/models/client';
import { loadAsset, loadBrandDna, loadRulebook } from '../src/domain/load';

const ASSETS = new URL('../assets/', import.meta.url).pathname;

describe('pod region reviewer task events', () => {
  it('emits per-region progress on Band\'s task channel (messageType task)', async () => {
    const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
    const eu = loadRulebook(`${ASSETS}rulebook.eu.json`);
    const asset = loadAsset(`${ASSETS}sample-asset.json`);
    const model = new StubModelClient(() => ({ text: '', json: { findings: [] } }));
    const room = new FakeBandTransport('r');
    await room.connectAgent({ agentId: 'lead', name: 'Reg Lead', handle: '@reg-lead', onMessage: async () => {} });
    await room.connectAgent({
      agentId: 'eu', name: 'EU Reviewer', handle: '@eu-reviewer',
      onMessage: makeRegionReviewer({ region: 'EU', reviewerName: 'EU Reviewer', rulebook: eu, brand, model, reportToHandle: '@reg-lead' }),
    });

    room.post('lead', JSON.stringify(asset), [{ id: 'eu' }]);
    await room.drain();

    const taskEvents = room.transcript.filter((t) => t.kind === 'event' && t.messageType === 'task');
    expect(taskEvents.length).toBeGreaterThanOrEqual(1);
    expect(taskEvents.some((t) => (t.content ?? '').includes('EU'))).toBe(true);
  });
});
