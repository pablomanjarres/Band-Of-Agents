// test/pod-multimaterial.test.ts
// "review the <advertisement>" reviews every material in turn: the Conductor drives
// material 1 -> verdict -> material 2 -> ... until all are done, then reports complete.
import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { StubModelClient, type ModelClient } from '../src/models/client';
import { connectPodBoardAgents, type PodBoardModels } from '../src/board/pod-board';
import { loadBrandDna, loadRulebook } from '../src/domain/load';

const ASSETS = new URL('../assets/', import.meta.url).pathname;

describe('multi-material review', () => {
  it('reviews every material of an advertisement in turn, then reports complete', async () => {
    const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
    const empty: ModelClient = new StubModelClient(() => ({ text: '', json: { findings: [] } }));
    const image: ModelClient = { model: 'stub', complete: async () => ({ text: '' }), generateImage: async () => ({ b64: 'AAAA' }) };
    const models: PodBoardModels = {
      scout: empty, claim: empty, precedent: empty, disclosure: empty,
      us: empty, eu: empty, latam: empty, brand: empty, channel: empty, visual: empty,
      mediator: empty, remediationCopy: empty, image,
    };

    const mat = (id: string) => ({ id, name: `Material ${id}`, channel: 'instagram', markets: ['US', 'EU', 'LATAM'], copy: 'clean balanced copy', claim: 'supports everyday wellness' });
    const materials = [mat('m1'), mat('m2'), mat('m3')];
    const lookupMaterials = async () => ({ name: 'Hero Launch', materials });

    const events: { t: string; c: string; asset?: unknown }[] = [];
    const room = new FakeBandTransport('mm', { onActivity: (a) => { if (a.kind === 'event') events.push({ t: a.messageType ?? '', c: a.content, asset: a.metadata?.asset }); } });
    room.addUser('lead', 'Compliance Lead', '@compliance-lead');
    await connectPodBoardAgents(room, {
      brand,
      rulebooks: { us: loadRulebook(`${ASSETS}rulebook.us.json`), eu: loadRulebook(`${ASSETS}rulebook.eu.json`), latam: loadRulebook(`${ASSETS}rulebook.latam.json`) },
      models,
      lookupMaterials,
      compact: true,
    });

    room.post('lead', 'review the Hero Launch advertisement', [{ id: 'cond' }]);
    await room.drain();

    // Each material was dispatched, in order.
    const dispatched = events.filter((e) => e.t === 'intake' && e.c.startsWith('Intake: dispatching')).map((e) => e.asset);
    expect(dispatched).toEqual(['m1', 'm2', 'm3']);

    // One terminal per material.
    expect(events.filter((e) => e.t === 'terminal').length).toBe(3);

    // The campaign closed with a complete summary.
    expect(events.some((e) => /Campaign review complete: 3 material/.test(e.c))).toBe(true);
  });
});
