// Core2 of the campaigns rung: campaign ORCHESTRATION. These tests pin the one
// rule end to end through CampaignSession: materials negotiate CONCURRENTLY with
// no campaign-wide gate (one material reaches a verdict while another is still
// mid-review), the dossier cascades into the reviewer prompt via the campaign
// run, and the observational rollup (worst-case per region + matrix) is correct.

import { describe, expect, it } from 'vitest';
import { CampaignSession, computeRollup } from '../src/board/campaign';
import type { BoardModels } from '../src/board/session';
import { StubModelClient, type CompleteRequest, type ModelClient } from '../src/models/client';
import { loadBrandDna, loadRulebook } from '../src/domain/load';
import { Campaign, type Finding, type RegionVerdict } from '../src/domain/types';
import type { BoardEvent } from '../src/board/events';

const ASSETS = new URL('../assets/', import.meta.url).pathname;

function findings(...items: Finding[]): { text: string; json: { findings: Finding[] } } {
  return { text: '', json: { findings: items } };
}

function brandAndRules() {
  return {
    brand: loadBrandDna(`${ASSETS}brand-dna.json`),
    rulebooks: {
      us: loadRulebook(`${ASSETS}rulebook.us.json`),
      eu: loadRulebook(`${ASSETS}rulebook.eu.json`),
      latam: loadRulebook(`${ASSETS}rulebook.latam.json`),
    },
  };
}

/** Which material this request is reviewing, read off the material JSON in the prompt. */
function materialIdOf(req: CompleteRequest): string {
  const first = req.messages[0];
  const text = typeof first?.content === 'string' ? first.content : JSON.stringify(first?.content ?? '');
  return /"id":\s*"([^"]+)"/.exec(text)?.[1] ?? '';
}

const EU_FIXABLE_BLOCK: Finding = {
  category: 'disclosure',
  severity: 'block',
  claim: 'whole material',
  rationale: 'Missing Article 10(2) statements.',
  ruleId: 'eu-mandatory-disclosure',
  requiredDisclosure: 'Article 10(2) accompanying statements',
};

const US_HARD_BLOCK: Finding = {
  category: 'pricing',
  severity: 'block',
  claim: 'free forever',
  rationale: 'Unqualified "free forever" is deceptive; not fixable by a disclosure.',
  ruleId: 'us-deceptive-pricing',
};

describe('THE ONE RULE end to end: materials negotiate concurrently, no shared gate', () => {
  it('a fast material reaches its verdict while a slow material is still mid-review', async () => {
    const { brand, rulebooks } = brandAndRules();

    // The slow material's EU reviewer blocks on a gate the test controls; every
    // other reviewer (and the fast material entirely) returns immediately. If
    // there were any campaign-wide gate, the fast material could not finish while
    // the slow one is parked. There is none, so it must.
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const cleared = new StubModelClient(() => findings());
    // An async ModelClient (not the sync StubModelClient responder): the slow
    // material's EU review parks on the gate until the test releases it.
    const euGated: ModelClient = {
      model: 'eu-gated',
      complete: async (req) => {
        if (materialIdOf(req) === 'slow') await gate;
        return findings();
      },
    };

    const models: BoardModels = {
      us: cleared,
      eu: euGated,
      latam: cleared,
      brand: cleared,
      remediationCopy: new StubModelClient(() => ({ text: 'n/a' })),
      image: { model: 'stub-image', complete: async () => ({ text: '' }) } satisfies ModelClient,
    };

    const campaign = Campaign.parse({
      id: 'camp-conc',
      name: 'Concurrency',
      markets: ['US'],
      dossier: { approvedClaims: [], substantiation: '', approvedInfo: '', sources: [] },
      materials: [
        { id: 'slow', kind: 'video', channel: 'social', markets: ['US'], copy: 'slow copy', claim: 'c' },
        { id: 'fast', kind: 'post', channel: 'x', markets: ['US'], copy: 'fast copy', claim: 'c' },
      ],
    });

    const verdictsByMaterial = new Map<string, RegionVerdict[]>();
    const session = new CampaignSession({
      roomId: 'room-conc',
      campaign,
      brand,
      rulebooks,
      models,
      onEvent: (e: BoardEvent) => {
        if (e.type === 'verdict' && e.materialId) verdictsByMaterial.set(e.materialId, e.verdicts);
      },
    });

    // Start the campaign but do NOT await it: the slow material is parked at its
    // EU reviewer, the fast material runs to a verdict.
    const done = session.run();

    // Wait for the fast material's verdict to land.
    for (let i = 0; i < 200 && !verdictsByMaterial.has('fast'); i++) {
      await new Promise((r) => setTimeout(r, 0));
    }

    // Proof of no campaign-wide gate: fast finished, slow has NOT (still gated).
    expect(verdictsByMaterial.has('fast')).toBe(true);
    expect(verdictsByMaterial.has('slow')).toBe(false);

    // Release the gate; now the slow material reconciles too, independently.
    releaseGate();
    const rollup = await done;
    expect(verdictsByMaterial.has('slow')).toBe(true);
    expect(rollup.perMaterial.length).toBe(2);
  });

  it('both materials reconcile independently (per-material verdicts tagged by materialId)', async () => {
    const { brand, rulebooks } = brandAndRules();
    // Material A: EU has a fixable block (adapt then publish after remediation).
    // Material B: clean everywhere (publish immediately). They share nothing.
    let euPassA = 0;
    const models: BoardModels = {
      us: new StubModelClient(() => findings()),
      eu: new StubModelClient((req) => {
        if (materialIdOf(req) !== 'matA') return findings();
        euPassA += 1;
        return euPassA === 1 ? findings(EU_FIXABLE_BLOCK) : findings();
      }),
      latam: new StubModelClient(() => findings()),
      brand: new StubModelClient(() => findings()),
      remediationCopy: new StubModelClient(() => ({ text: 'supports everyday wellness as part of a balanced diet and healthy lifestyle.' })),
      image: { model: 'stub-image', complete: async () => ({ text: '' }), generateImage: async () => ({ url: 'https://cdn.aimlapi.com/a.png' }) } satisfies ModelClient,
    };

    const campaign = Campaign.parse({
      id: 'camp-indep',
      name: 'Independent',
      markets: ['US', 'EU', 'LATAM'],
      dossier: { approvedClaims: [], substantiation: '', approvedInfo: '', sources: [] },
      materials: [
        { id: 'matA', kind: 'video', channel: 'social', markets: ['US', 'EU'], copy: 'a', claim: 'a' },
        { id: 'matB', kind: 'post', channel: 'x', markets: ['US', 'EU'], copy: 'b', claim: 'b' },
      ],
    });

    const events: BoardEvent[] = [];
    const session = new CampaignSession({ roomId: 'room-indep', campaign, brand, rulebooks, models, onEvent: (e) => events.push(e) });
    const rollup = await session.run();

    // matB has exactly one verdict round (clean); matA has at least two (adapt -> publish).
    const verdictsA = events.filter((e) => e.type === 'verdict' && e.materialId === 'matA');
    const verdictsB = events.filter((e) => e.type === 'verdict' && e.materialId === 'matB');
    expect(verdictsB.length).toBe(1);
    expect(verdictsA.length).toBeGreaterThanOrEqual(2);

    // Every emitted verdict/review carries the right materialId (findings tie to the material).
    const reviewMatIds = new Set(events.filter((e) => e.type === 'review').map((e) => e.materialId));
    expect(reviewMatIds).toEqual(new Set(['matA', 'matB']));

    // Both materials terminate; the rollup covers both.
    expect(rollup.perMaterial.map((m) => m.materialId).sort()).toEqual(['matA', 'matB']);
    const final = rollup.perMaterial;
    expect(final.find((m) => m.materialId === 'matB')?.verdicts.every((v) => v.decision === 'publish')).toBe(true);
  });
});

describe('the dossier cascades into the region-reviewer prompt through a campaign run', () => {
  it('every reviewer of every material sees the campaign dossier text', async () => {
    const { brand, rulebooks } = brandAndRules();
    const seenSystems: string[] = [];
    // A capturing model used for every region so we can read the assembled prompt.
    const capture = new StubModelClient((req) => {
      seenSystems.push(req.system ?? '');
      return findings();
    });
    const models: BoardModels = {
      us: capture,
      eu: capture,
      latam: capture,
      brand: new StubModelClient(() => findings()),
      remediationCopy: new StubModelClient(() => ({ text: 'n/a' })),
      image: { model: 'stub-image', complete: async () => ({ text: '' }) } satisfies ModelClient,
    };

    const campaign = Campaign.parse({
      id: 'camp-cascade',
      name: 'Cascade',
      markets: ['US'],
      dossier: {
        approvedClaims: ['Clinically supported to maintain a healthy immune response'],
        substantiation: 'RCT n=240, data on file ref DF-2026-07.',
        approvedInfo: 'Always present as part of a balanced diet.',
        sources: [{ name: 'trial-summary', kind: 'text', content: 'Primary endpoint met.' }],
      },
      materials: [
        { id: 'm1', kind: 'video', channel: 'social', markets: ['US'], copy: 'c1', claim: 'c1' },
        { id: 'm2', kind: 'post', channel: 'x', markets: ['US'], copy: 'c2', claim: 'c2' },
      ],
    });

    const session = new CampaignSession({ roomId: 'room-cascade', campaign, brand, rulebooks, models, onEvent: () => {} });
    await session.run();

    // The dossier is authoritative context in EVERY reviewer's system prompt.
    const dossierSystems = seenSystems.filter((s) => s.includes('Campaign dossier'));
    expect(dossierSystems.length).toBeGreaterThan(0);
    expect(dossierSystems.every((s) => s.includes('DF-2026-07'))).toBe(true);
    expect(dossierSystems.some((s) => s.includes('Clinically supported to maintain a healthy immune response'))).toBe(true);
    expect(dossierSystems.some((s) => s.includes('balanced diet'))).toBe(true);
    expect(dossierSystems.some((s) => s.includes('trial-summary'))).toBe(true);
  });
});

describe('campaign loads/validates and the worst-case rollup is correct', () => {
  it('computeRollup folds per-material verdicts into worst-case (block beats adapt beats publish)', () => {
    const perMaterial = [
      {
        materialId: 'mA',
        verdicts: [
          { region: 'US', decision: 'publish', rationale: 'ok' },
          { region: 'EU', decision: 'adapt', rationale: 'disclosure' },
        ] as RegionVerdict[],
      },
      {
        materialId: 'mB',
        verdicts: [
          { region: 'US', decision: 'escalate', rationale: 'hard block' },
          { region: 'EU', decision: 'publish', rationale: 'ok' },
        ] as RegionVerdict[],
      },
    ];
    const rollup = computeRollup('camp-x', perMaterial);
    const byRegion = new Map(rollup.worstCaseByRegion.map((r) => [r.region, r.decision]));
    // US: escalate beats publish. EU: adapt beats publish.
    expect(byRegion.get('US')).toBe('escalate');
    expect(byRegion.get('EU')).toBe('adapt');
    // The matrix has one cell per (material, region).
    expect(rollup.matrix.length).toBe(4);
    expect(rollup.matrix).toContainEqual({ materialId: 'mB', region: 'US', decision: 'escalate', rationale: 'hard block' });
  });

  it('runs a 3-material campaign and computes the correct worst-case rollup over real verdicts', async () => {
    const { brand, rulebooks } = brandAndRules();
    // m-pub: clean -> publish everywhere. m-adapt: EU fixable block -> adapt then
    // publish. m-esc: US hard block -> escalate. Worst-case: US=escalate, others publish.
    let euAdaptPass = 0;
    const models: BoardModels = {
      us: new StubModelClient((req) => (materialIdOf(req) === 'm-esc' ? findings(US_HARD_BLOCK) : findings())),
      eu: new StubModelClient((req) => {
        if (materialIdOf(req) !== 'm-adapt') return findings();
        euAdaptPass += 1;
        return euAdaptPass === 1 ? findings(EU_FIXABLE_BLOCK) : findings();
      }),
      latam: new StubModelClient(() => findings()),
      brand: new StubModelClient(() => findings()),
      remediationCopy: new StubModelClient(() => ({ text: 'supports everyday wellness as part of a balanced diet and healthy lifestyle.' })),
      image: { model: 'stub-image', complete: async () => ({ text: '' }), generateImage: async () => ({ url: 'https://cdn.aimlapi.com/x.png' }) } satisfies ModelClient,
    };

    const campaign = Campaign.parse({
      id: 'camp-roll',
      name: 'Rollup',
      markets: ['US', 'EU', 'LATAM'],
      dossier: { approvedClaims: [], substantiation: '', approvedInfo: '', sources: [] },
      materials: [
        { id: 'm-pub', kind: 'post', channel: 'x', markets: ['US', 'EU', 'LATAM'], copy: 'p', claim: 'p' },
        { id: 'm-adapt', kind: 'video', channel: 'social', markets: ['US', 'EU', 'LATAM'], copy: 'a', claim: 'a' },
        { id: 'm-esc', kind: 'banner', channel: 'display', markets: ['US'], copy: 'free forever', claim: 'free' },
      ],
    });

    const session = new CampaignSession({ roomId: 'room-roll', campaign, brand, rulebooks, models, onEvent: () => {} });
    const rollup = await session.run();

    expect(rollup.perMaterial.length).toBe(3);
    const byRegion = new Map(rollup.worstCaseByRegion.map((r) => [r.region, r.decision]));
    expect(byRegion.get('US')).toBe('escalate'); // from m-esc
    expect(byRegion.get('EU')).toBe('publish'); // m-adapt remediated to publish
    expect(byRegion.get('LATAM')).toBe('publish');
    expect(byRegion.get('BRAND')).toBe('publish');
    // Full matrix: 3 materials x 4 regions = 12 cells.
    expect(rollup.matrix.length).toBe(12);
  });

  it('validates a campaign from JSON (one-level materials, dossier defaults)', () => {
    const camp = Campaign.parse({
      id: 'c',
      name: 'n',
      dossier: {},
      materials: [{ id: 'm', kind: 'image', channel: 'ig', markets: ['US'], copy: 'c', claim: 'c' }],
    });
    expect(camp.markets).toEqual([]);
    expect(camp.dossier.sources).toEqual([]);
    expect(camp.materials[0]?.kind).toBe('image');
  });
});
