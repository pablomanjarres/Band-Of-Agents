// test/conductor.test.ts
import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { makeConductor } from '../src/agents/conductor';
import { loadAsset } from '../src/domain/load';

const ASSETS = new URL('../assets/', import.meta.url).pathname;

describe('conductor', () => {
  it('dispatches a fresh asset to every pod lead, and re-dispatches a revised asset', async () => {
    const asset = loadAsset(`${ASSETS}sample-asset.json`);
    const got: Record<string, number> = {};
    const room = new FakeBandTransport('r');
    for (const [id, handle] of [['cl', '@claims-lead'], ['rg', '@reg-lead'], ['br', '@brand-lead']] as const) {
      await room.connectAgent({ agentId: id, name: handle, handle, onMessage: async () => { got[handle] = (got[handle] ?? 0) + 1; } });
    }
    await room.connectAgent({ agentId: 'cond', name: 'Conductor', handle: '@conductor', onMessage: makeConductor({ podLeadHandles: ['@claims-lead', '@reg-lead', '@brand-lead'] }) });

    room.post('lead', JSON.stringify(asset), [{ id: 'cond' }]);
    await room.drain();
    expect(got['@claims-lead']).toBe(1);
    expect(got['@reg-lead']).toBe(1);
    expect(got['@brand-lead']).toBe(1);

    room.post('rem', JSON.stringify({ kind: 'revised', region: 'EU', revised: asset }), [{ id: 'cond' }]);
    await room.drain();
    expect(got['@reg-lead']).toBe(2);
  });
});
