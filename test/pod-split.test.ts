// test/pod-split.test.ts
// When markets collide irreconcilably (one bans a span another allows), the human
// can approve a SPLIT: the board produces one tailored version per market and
// publishes them per-market, instead of forcing one watered-down version.
import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { StubModelClient, type ModelClient } from '../src/models/client';
import { connectPodBoardAgents, type PodBoardModels } from '../src/board/pod-board';
import { translateActivity, type BoardEvent } from '../src/board/events';
import { loadBrandDna, loadRulebook } from '../src/domain/load';

const ASSETS = new URL('../assets/', import.meta.url).pathname;
const fnd = (...fs: unknown[]) => ({ text: '', json: { findings: fs } });

describe('market split on an irreconcilable collision', () => {
  it('asks to split, then publishes one tailored version per market on approval', async () => {
    const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
    const asset = { id: 'neuropeak-q3', name: 'NeuroPeak Q3', channel: 'instagram', markets: ['US', 'EU', 'LATAM'], copy: 'NeuroPeak is clinically proven to boost your immune system.', claim: 'clinically proven', substantiation: 'RCTs on file.' };

    const empty: ModelClient = new StubModelClient(() => ({ text: '', json: { findings: [] } }));
    // US passes the health claim; EU and LATAM block it -> a cross-market collision.
    const us: ModelClient = new StubModelClient(() => fnd({ category: 'health', severity: 'info', claim: 'clinically proven to boost your immune system', rationale: 'OK with substantiation.', ruleId: 'us-health' }));
    let euCall = 0;
    const eu: ModelClient = new StubModelClient(() => (euCall++ % 2 === 0
      ? fnd({ category: 'health', severity: 'block', claim: 'clinically proven to boost your immune system', rationale: 'Unauthorised.', ruleId: 'eu-health' })
      : { text: '', json: { stance: 'hold', rationale: 'unlawful' } }));
    const latam: ModelClient = new StubModelClient(() => fnd({ category: 'loc', severity: 'block', claim: 'clinically proven to boost your immune system', rationale: 'Localize + register.', ruleId: 'latam-loc' }));
    const mediator: ModelClient = new StubModelClient(() => ({ text: '', json: { resolved: false, note: 'no movement', requiredDisclosure: null } }));
    const revised: ModelClient = new StubModelClient(() => ({ text: 'Supports everyday wellness.' }));
    const image: ModelClient = { model: 'stub-image', complete: async () => ({ text: '' }), generateImage: async () => ({ b64: 'AAAA' }) };

    const models: PodBoardModels = {
      scout: empty, claim: empty, precedent: empty, disclosure: empty,
      us, eu, latam, brand: empty, channel: empty, visual: empty,
      mediator, remediationCopy: revised, image,
    };

    const events: BoardEvent[] = [];
    let imgN = 0;
    const room = new FakeBandTransport('split', { onActivity: (a) => { const e = translateActivity(a); if (e) events.push(e); } });
    room.addUser('lead', 'Compliance Lead', '@compliance-lead');
    await connectPodBoardAgents(room, {
      brand,
      rulebooks: { us: loadRulebook(`${ASSETS}rulebook.us.json`), eu: loadRulebook(`${ASSETS}rulebook.eu.json`), latam: loadRulebook(`${ASSETS}rulebook.latam.json`) },
      models,
      hostImage: () => `http://img/v${++imgN}.png`,
      compact: true,
    });

    room.post('lead', JSON.stringify(asset), [{ id: 'cond' }]);
    await room.drain();

    // The adjudicator asked the human to split (the report message carries the prompt).
    const askMsg = room.transcript.find((t) => t.kind === 'message' && /market-tailored versions/.test(t.content));
    expect(askMsg).toBeDefined();
    // No terminal yet (gated on approval).
    expect(events.some((e) => e.type === 'terminal')).toBe(false);

    room.post('lead', 'yes ship the market versions', [{ id: 'adj' }]);
    await room.drain();

    // Every market published per-market: US (which passes) ships the original, EU and
    // LATAM (which ban the claim) ship a tailored version. A terminal published landed.
    const adj = events.filter((e): e is Extract<BoardEvent, { type: 'adjudication' }> => e.type === 'adjudication');
    for (const region of ['US', 'EU', 'LATAM']) {
      expect(adj.some((e) => e.text.startsWith(`${region}: published`))).toBe(true);
    }
    expect(adj.some((e) => e.text.includes('EU: published (market-tailored)'))).toBe(true);
    expect(adj.some((e) => e.text.includes('LATAM: published (market-tailored)'))).toBe(true);
    expect(adj.some((e) => e.text.includes('US: published (original'))).toBe(true);
    expect(events.some((e) => e.type === 'terminal' && e.decision === 'published')).toBe(true);

    // The final report lists all three market-tailored versions with their image links.
    const finalReport = [...room.transcript].reverse().find((t) => t.kind === 'message' && /Proposed market-tailored versions/.test(t.content));
    expect(finalReport).toBeDefined();
    expect(finalReport!.content).toContain('US:');
    expect(finalReport!.content).toContain('EU:');
    expect(finalReport!.content).toContain('LATAM:');
    expect(finalReport!.content).toMatch(/new image: http:\/\/img\/v\d\.png/);
  });
});
