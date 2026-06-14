// test/brand-pod.test.ts
import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { makePodLead } from '../src/agents/pod-lead';
import { makeBrandVoice, makeChannel, makeVisual } from '../src/agents/pod-members';
import { StubModelClient } from '../src/models/client';
import { loadAsset } from '../src/domain/load';

const ASSETS = new URL('../assets/', import.meta.url).pathname;

describe('brand pod', () => {
  it('files one brand PodFinding with no cross-region conflict', async () => {
    const asset = loadAsset(`${ASSETS}sample-asset.json`);
    const ok = new StubModelClient(() => ({ text: '', json: { findings: [] } }));
    const offVoice = new StubModelClient(() => ({ text: '', json: { findings: [{ category: 'voice', severity: 'warn', claim: asset.copy, rationale: 'too clinical' }] } }));
    const filed: string[] = [];
    const room = new FakeBandTransport('r');
    await room.connectAgent({ agentId: 'adj', name: 'Adjudicator', handle: '@adjudicator', onMessage: async (m) => { filed.push(m.content); } });
    await room.connectAgent({ agentId: 'lead', name: 'Brand Lead', handle: '@brand-lead', onMessage: makePodLead({ pod: 'brand', members: ['@brand-voice', '@channel', '@visual'], memberKeys: ['brand-voice', 'channel', 'visual'], reportToHandle: '@adjudicator', debate: false }) });
    await room.connectAgent({ agentId: 'bv', name: 'Brand Voice', handle: '@brand-voice', onMessage: makeBrandVoice(offVoice) });
    await room.connectAgent({ agentId: 'ch', name: 'Channel Fit', handle: '@channel', onMessage: makeChannel(ok) });
    await room.connectAgent({ agentId: 'vis', name: 'Visual', handle: '@visual', onMessage: makeVisual(ok) });

    room.post('cond', JSON.stringify(asset), [{ id: 'lead' }]);
    await room.drain();

    expect(filed).toHaveLength(1);
    const pf = JSON.parse(filed[0]!);
    expect(pf.pod).toBe('brand');
    expect(pf.findings).toHaveLength(1);
    expect(pf.conflicts).toEqual([]);
  });
});
