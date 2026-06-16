// THE ONE RULE over the BAND transport: a campaign (multi-advertisement,
// multi-material) reviewed through band.ai runs as MANY concurrent per-material
// rooms with NO campaign-wide or advertisement-wide gate. This proves it on the
// in-process FakeBandTransport (no band.ai credentials), exactly the way the
// single-asset band flow is tested: a BandBoard with the real agent factories,
// driven by a FakeBandTransport-backed IntakeControl, observed per material.
//
// The proof: across THREE advertisements, one material publishes, one adapts then
// publishes (remediation re-review), and one ESCALATES and rests at
// awaiting-decision. The escalated material does NOT hold up the others: the run
// resolves with every other material terminal and the rollup carries them all,
// each verdict tagged with advertisementId + materialId. computeRollup folds them
// into the per-advertisement + campaign worst-case. Then a human ruling on the
// escalated material is relayed into ITS room and completes only that material.

import { describe, expect, it } from 'vitest';
import { BandBoard } from '../src/board/band-session';
import { CampaignBandSession } from '../src/board/campaign-band';
import { FakeBandTransport, makeFakeIntakeControl } from '../src/band/fake';
import { StubModelClient, type CompleteRequest, type ModelClient } from '../src/models/client';
import type { BoardModels } from '../src/board/session';
import { loadBrandDna, loadRulebook } from '../src/domain/load';
import { Campaign, type Finding, type RegionVerdict } from '../src/domain/types';
import type { BoardEvent } from '../src/board/events';

const ASSETS = new URL('../assets/', import.meta.url).pathname;

function findings(...items: Finding[]): { text: string; json: { findings: Finding[] } } {
  return { text: '', json: { findings: items } };
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

// A BandBoard wired to a FakeBandTransport + a fake intake control, plus a
// captured per-material event log. Mirrors how BandBoard runs in band mode, but in
// process. The human compliance lead is seeded so an escalation can rest and then
// be ruled on through the intake proxy.
function bandBoardOnFake(models: BoardModels) {
  const { brand, rulebooks } = brandAndRules();
  let fake: FakeBandTransport | undefined;
  const precedents: { regions: string[]; decision: string }[] = [];
  const board = new BandBoard({
    brand,
    rulebooks,
    models,
    humanHandle: '@compliance-lead',
    logPrecedent: (p) => precedents.push({ regions: p.regions, decision: p.decision }),
    onReviewDiscovered: () => () => {},
    // Inject a FakeBandTransport so the band flow runs in-process (no credentials).
    transport: (onActivity) => {
      fake = new FakeBandTransport('campaign-room', { onActivity });
      fake.addUser('lead', 'Compliance Lead', '@compliance-lead');
      return fake;
    },
    // The intake is a FakeBandTransport-backed control (the band.ai SDK posts only
    // as an agent; the proxy relays the kickoff and any human ruling). It is read
    // lazily at run() time, by which point the transport factory has set `fake`.
    makeIntakeControl: () => makeFakeIntakeControl(fake as FakeBandTransport),
  });
  return { board, precedents };
}

describe('THE ONE RULE over band.ai: per-material rooms, no campaign/ad-wide gate', () => {
  it('reviews a multi-ad campaign as concurrent per-material rooms; verdicts tagged across ads', async () => {
    // m-pub: clean -> publish. m-adapt: EU fixable block -> adapt then publish.
    // m-esc: US hard block -> escalate (rests at awaiting-decision).
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

    const { board, precedents } = bandBoardOnFake(models);
    await board.start();

    // Three advertisements; "Hero" holds the clean + remediating materials, the
    // others the escalating banner and a second clean post. Proves no AD-wide gate
    // (materials live in different ads) and no CAMPAIGN-wide gate.
    const campaign = Campaign.parse({
      id: 'camp-band',
      name: 'Band Launch',
      markets: ['US', 'EU', 'LATAM'],
      dossier: { approvedClaims: [], substantiation: 'DF-2026-09 on file.', approvedInfo: '', sources: [] },
      advertisements: [
        {
          id: 'ad-hero',
          name: 'Hero',
          materials: [
            { id: 'm-pub', kind: 'post', channel: 'x', markets: ['US', 'EU', 'LATAM'], copy: 'p', claim: 'p' },
            { id: 'm-adapt', kind: 'video', channel: 'social', markets: ['US', 'EU', 'LATAM'], copy: 'a', claim: 'a' },
          ],
        },
        { id: 'ad-promo', name: 'Promo', materials: [{ id: 'm-esc', kind: 'banner', channel: 'display', markets: ['US'], copy: 'free forever', claim: 'free' }] },
        { id: 'ad-side', name: 'Side', materials: [{ id: 'm-side', kind: 'post', channel: 'ig', markets: ['EU'], copy: 's', claim: 's' }] },
      ],
    });

    const events: BoardEvent[] = [];
    const session = new CampaignBandSession({
      roomId: 'run-1',
      campaign,
      board,
      onEvent: (e) => events.push(e),
    });

    expect(session.materialIds().sort()).toEqual(['m-adapt', 'm-esc', 'm-pub', 'm-side']);

    const rollup = await session.run();

    // Every material reached a terminal verdict, ACROSS the three advertisements,
    // EVEN THOUGH m-esc escalated and rests: no campaign/ad-wide gate held the rest.
    expect(rollup.perMaterial.map((m) => m.materialId).sort()).toEqual(['m-adapt', 'm-esc', 'm-pub', 'm-side']);

    // Each per-material entry carries the right advertisement (verdicts are tagged).
    const adOf = new Map(rollup.perMaterial.map((m) => [m.materialId, m.advertisementId]));
    expect(adOf.get('m-pub')).toBe('ad-hero');
    expect(adOf.get('m-adapt')).toBe('ad-hero');
    expect(adOf.get('m-esc')).toBe('ad-promo');
    expect(adOf.get('m-side')).toBe('ad-side');

    // Every emitted verdict/review event is tagged with BOTH ids so the SSE lanes it.
    const verdictEvents = events.filter((e) => e.type === 'verdict');
    expect(verdictEvents.length).toBeGreaterThan(0);
    expect(verdictEvents.every((e) => typeof e.materialId === 'string' && typeof e.advertisementId === 'string' && e.campaignId === 'camp-band')).toBe(true);
    const reviewMatIds = new Set(events.filter((e) => e.type === 'review').map((e) => e.materialId));
    expect(reviewMatIds).toEqual(new Set(['m-pub', 'm-adapt', 'm-esc', 'm-side']));

    // m-esc rested at awaiting-decision (a human is needed) WITHOUT blocking siblings.
    const escStatuses = events.filter((e) => e.type === 'status' && e.materialId === 'm-esc').map((e) => (e as { status: string }).status);
    expect(escStatuses).toContain('awaiting-decision');

    // Per-material decisions: m-pub/m-side publish everywhere, m-adapt remediated to
    // publish in EU, m-esc escalates in US. The rollup folds the worst case.
    const finalOf = (id: string) => rollup.perMaterial.find((m) => m.materialId === id)?.verdicts ?? [];
    const dec = (vs: RegionVerdict[], region: string) => vs.find((v) => v.region === region)?.decision;
    expect(finalOf('m-pub').every((v) => v.decision === 'publish')).toBe(true);
    expect(finalOf('m-side').every((v) => v.decision === 'publish')).toBe(true);
    expect(dec(finalOf('m-adapt'), 'EU')).toBe('publish'); // adapt -> remediated -> publish
    expect(dec(finalOf('m-esc'), 'US')).toBe('escalate');

    // computeRollup over the per-material verdicts: campaign worst-case folds all ads.
    const byRegion = new Map(rollup.worstCaseByRegion.map((r) => [r.region, r.decision]));
    expect(byRegion.get('US')).toBe('escalate'); // from m-esc (Promo)
    expect(byRegion.get('EU')).toBe('publish');
    expect(byRegion.get('BRAND')).toBe('publish');

    // Per-advertisement rollup: Hero/Side never escalate; Promo does.
    const hero = rollup.perAdvertisement.find((a) => a.advertisementId === 'ad-hero')!;
    const promo = rollup.perAdvertisement.find((a) => a.advertisementId === 'ad-promo')!;
    expect(new Map(hero.worstCaseByRegion.map((r) => [r.region, r.decision])).get('US')).toBe('publish');
    expect(new Map(promo.worstCaseByRegion.map((r) => [r.region, r.decision])).get('US')).toBe('escalate');

    // The escalated material can now be ruled on: the human ruling is relayed into
    // ITS room (via the intake proxy), recorded as a decision (+ precedent) and the
    // material completes. It does not touch any other material's room.
    await session.submitDecision('m-esc', 'Approve with the US risk noted.');
    const escDecisions = events.filter((e) => e.type === 'decision' && e.materialId === 'm-esc');
    expect(escDecisions.length).toBeGreaterThanOrEqual(1);
    // The decision carried the material id so the SSE laned it; the precedent was logged.
    expect(precedents.some((p) => p.regions.includes('US') && p.decision.includes('Approve'))).toBe(true);
    // m-esc completed; the ruling closed only that material's room.
    const escFinal = events.filter((e) => e.type === 'status' && e.materialId === 'm-esc').map((e) => (e as { status: string }).status);
    expect(escFinal).toContain('complete');
  });

  it('a single-advertisement scope reviews ONLY that ad\'s materials (still per material, no gate)', async () => {
    const cleared = new StubModelClient(() => findings());
    const models: BoardModels = {
      us: cleared,
      eu: cleared,
      latam: cleared,
      brand: cleared,
      remediationCopy: new StubModelClient(() => ({ text: 'n/a' })),
      image: { model: 'stub-image', complete: async () => ({ text: '' }) } satisfies ModelClient,
    };
    const { board } = bandBoardOnFake(models);
    await board.start();

    const campaign = Campaign.parse({
      id: 'camp-scope-band',
      name: 'Scope Band',
      markets: ['US'],
      dossier: { approvedClaims: [], substantiation: '', approvedInfo: '', sources: [] },
      advertisements: [
        { id: 'ad-1', name: 'Ad One', materials: [{ id: 'a1-m1', kind: 'post', channel: 'x', markets: ['US'], copy: 'a1m1', claim: 'c' }] },
        {
          id: 'ad-2',
          name: 'Ad Two',
          materials: [
            { id: 'a2-m1', kind: 'video', channel: 'social', markets: ['US'], copy: 'a2m1', claim: 'c' },
            { id: 'a2-m2', kind: 'post', channel: 'x', markets: ['US'], copy: 'a2m2', claim: 'c' },
          ],
        },
        { id: 'ad-3', name: 'Ad Three', materials: [{ id: 'a3-m1', kind: 'banner', channel: 'display', markets: ['US'], copy: 'a3m1', claim: 'c' }] },
      ],
    });

    const events: BoardEvent[] = [];
    const session = new CampaignBandSession({
      roomId: 'run-scope',
      campaign,
      advertisementId: 'ad-2',
      board,
      onEvent: (e) => events.push(e),
    });

    expect(session.materialIds().sort()).toEqual(['a2-m1', 'a2-m2']);
    const rollup = await session.run();

    // Only ad-2's two materials were ever reviewed; ad-1 and ad-3 never were.
    const reviewedMats = new Set(events.filter((e) => e.type === 'review').map((e) => e.materialId));
    expect(reviewedMats).toEqual(new Set(['a2-m1', 'a2-m2']));
    expect(events.some((e) => e.materialId === 'a1-m1' || e.materialId === 'a3-m1')).toBe(false);
    expect(events.filter((e) => e.advertisementId !== undefined).every((e) => e.advertisementId === 'ad-2')).toBe(true);

    // The rollup covers only the scoped advertisement.
    expect(rollup.perAdvertisement.map((a) => a.advertisementId)).toEqual(['ad-2']);
    expect(rollup.perMaterial.map((m) => m.materialId).sort()).toEqual(['a2-m1', 'a2-m2']);
    expect(rollup.matrix.every((cell) => cell.advertisementId === 'ad-2')).toBe(true);
  });
});
