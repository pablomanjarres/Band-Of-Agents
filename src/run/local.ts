// Local end-to-end demo on the in-process fake transport. The default run is a
// MULTI-MATERIAL CAMPAIGN driven through CampaignSession: one product (a shared
// dossier) with several marketing materials, each negotiated by the full
// US/EU/LATAM/BRAND + reconcile + remediation board CONCURRENTLY (not material-1
// then material-2). It prints each material's events as they interleave and the
// final observational rollup (worst-case per region + the material x region
// matrix). Stub models keep it key-free and deterministic.
//
// The single-asset run is still reachable for comparison:  pnpm local single
//
//   pnpm local            (concurrent multi-material campaign)
//   pnpm local single     (one asset, the legacy path)

import { BoardSession, type BoardModels } from '../board/session';
import { CampaignSession } from '../board/campaign';
import { StubModelClient, StubSttClient, type CompleteRequest, type ModelClient, type SttClient } from '../models/client';
import { loadAsset, loadBrandDna, loadRulebook } from '../domain/load';
import { Campaign, type Finding } from '../domain/types';
import type { BoardEvent } from '../board/events';

const ASSETS = new URL('../../assets/', import.meta.url).pathname;

type FindingsResult = { text: string; json: { findings: Finding[] } };

function findings(...items: Finding[]): FindingsResult {
  return { text: '', json: { findings: items } };
}

/** Which material a reviewer is looking at, read off the material JSON in the prompt. */
function materialIdOf(req: CompleteRequest): string {
  const first = req.messages[0];
  const text = typeof first?.content === 'string' ? first.content : JSON.stringify(first?.content ?? '');
  const m = /"id":\s*"([^"]+)"/.exec(text);
  return m?.[1] ?? '';
}

function printEvent(e: BoardEvent): void {
  const tag = e.materialId ? `[${e.materialId}] ` : '';
  switch (e.type) {
    case 'intake':
      console.log(`  ${tag}intake: "${e.asset.name ?? e.asset.id}" for ${e.asset.markets.join(', ')}`);
      break;
    case 'recruited':
    case 'progress':
    case 'log':
      console.log(`  ${tag}${e.fromName}: ${e.text}`);
      break;
    case 'review':
      console.log(`  ${tag}${e.reviewerName}: ${e.region} review, ${e.findings.length} finding(s), ${e.blocking} blocking`);
      break;
    case 'verdict':
      console.log(`  ${tag}VERDICT: ${e.verdicts.map((v) => `${v.region}=${v.decision}`).join(', ')} (conflict=${e.conflict})`);
      break;
    case 'revised':
      console.log(`  ${tag}REVISED ${e.region}: ${e.copy.slice(0, 60)} [image ${e.imageUrl ? 'yes' : 'no'}]`);
      break;
    case 'escalation':
      console.log(`  ${tag}ESCALATION: ${e.text}`);
      break;
    case 'decision':
      console.log(`  ${tag}DECISION: ${e.text}`);
      break;
    case 'status':
      console.log(`  ${tag}[status: ${e.status}]`);
      break;
    case 'perceiving':
      console.log(`  ${tag}perceiving [${e.stage}] frame ${e.index + 1}/${e.total}${e.frameUrl ? ` ${e.frameUrl}` : ''}`);
      break;
  }
}

// Per-region stub findings keyed by material id. The dossier pre-clears
// "clinically proven ... immunity" for the campaign, so a reviewer that trusts
// the dossier (US here) lets the hero video run while EU still demands the
// authorised wording, and the banner carries an unfixable US claim that escalates.
const US_FINDINGS: Record<string, Finding[]> = {
  'hero-video': [
    { category: 'endorsement', severity: 'warn', claim: '9 out of 10 felt the difference', rationale: 'Add a typical-results note; substantiation is on file in the dossier.', ruleId: 'us-testimonial' },
  ],
  'launch-post': [],
  'promo-banner': [
    { category: 'pricing', severity: 'block', claim: 'free forever, no strings', rationale: 'Unqualified "free forever" is deceptive; not fixable by a disclosure.', ruleId: 'us-deceptive-pricing' },
  ],
};

const EU_FINDINGS: Record<string, Finding[]> = {
  'hero-video': [
    { category: 'disclosure', severity: 'block', claim: 'whole material', rationale: 'Missing Article 10(2) accompanying statements.', ruleId: 'eu-mandatory-disclosure', requiredDisclosure: 'Article 10(2) accompanying statements' },
  ],
  'launch-post': [],
  'promo-banner': [],
};

const LATAM_FINDINGS: Record<string, Finding[]> = {
  'hero-video': [
    { category: 'localization', severity: 'block', claim: 'whole material', rationale: 'Copy is not localized to Portuguese/Spanish.', ruleId: 'latam-localization', requiredDisclosure: 'Localized copy' },
  ],
  'launch-post': [],
  'promo-banner': [],
};

function regionStub(table: Record<string, Finding[]>): ModelClient {
  return new StubModelClient((req) => findings(...(table[materialIdOf(req)] ?? [])));
}

// Stub perception (vision + STT) for the key-free demo: the vision model returns a
// canned description/OCR/claims and STT returns a canned transcript, so the
// perception pass produces real artifacts and emits 'perceiving' ticks over the
// seeded frames without any network or ffmpeg.
function stubPerception(): { vision: ModelClient; stt: SttClient } {
  const vision = new StubModelClient(() => ({
    text: '',
    json: {
      visualDescription: 'Warm flat-lay of Northwind Immune+ bottles with citrus and eucalyptus, then a close-up as on-screen text fades in.',
      onScreenText: 'Northwind Immune+ | Feel your best, every day | 9 out of 10 felt the difference',
      detectedClaims: ['Helps maintain your immune response', '9 out of 10 users felt the difference in two weeks'],
    },
  }));
  const stt: SttClient = new StubSttClient(() => ({
    text: 'Feeling run down? Northwind Immune plus helps maintain your immune response so you can feel your best, every day. Nine out of ten users felt the difference in two weeks.',
  }));
  return { vision, stt };
}

function campaignModels(): BoardModels {
  return {
    us: regionStub(US_FINDINGS),
    eu: regionStub(EU_FINDINGS),
    latam: regionStub(LATAM_FINDINGS),
    brand: new StubModelClient(() => findings()),
    remediationCopy: new StubModelClient(() => ({ text: 'Apoia o seu bem-estar diario como parte de uma dieta variada e equilibrada e de um estilo de vida saudavel.' })),
    image: { model: 'stub-image', complete: async () => ({ text: '' }), generateImage: async () => ({ url: 'https://cdn.aimlapi.com/campaign-latam.png' }) } satisfies ModelClient,
  };
}

// One product, several materials, one shared dossier. The dossier is the
// cascading source-of-truth that grounds every reviewer of every material.
function demoCampaign(): Campaign {
  return Campaign.parse({
    id: 'immune-plus-q3',
    name: 'Immune+ Q3 Launch',
    markets: ['US', 'EU', 'LATAM'],
    dossier: {
      approvedClaims: ['Clinically supported to help maintain a healthy immune response'],
      substantiation: 'Two RCTs (n=240, n=180) on the Immune+ formula; typical-results data on file ref DF-2026-07.',
      approvedInfo: 'Always present claims as part of a varied, balanced diet and a healthy lifestyle.',
      sources: [{ name: 'trial-summary', kind: 'text', content: 'Double-blind, placebo-controlled; primary immune-response endpoint met.' }],
    },
    materials: [
      { id: 'hero-video', name: 'Hero Video', kind: 'video', channel: 'instagram', markets: ['US', 'EU', 'LATAM'], copy: 'Feel your best. Northwind Immune+ helps maintain your immune response. 9 out of 10 felt the difference.', claim: 'helps maintain immune response', videoUrl: '/api/videos/immune-plus-hero.mp4', perception: { frames: ['/api/images/immune-plus-frame-01.png', '/api/images/immune-plus-frame-02.png', '/api/images/immune-plus-frame-03.png', '/api/images/immune-plus-frame-04.png'] } },
      { id: 'launch-post', name: 'Launch Post', kind: 'post', channel: 'x', markets: ['US', 'EU', 'LATAM'], copy: 'Northwind Immune+ supports everyday wellness as part of a balanced diet and healthy lifestyle.', claim: 'supports everyday wellness' },
      { id: 'promo-banner', name: 'Promo Banner', kind: 'banner', channel: 'display', markets: ['US'], copy: 'Northwind Immune+: free forever, no strings. Claim yours now.', claim: 'free forever' },
    ],
  });
}

async function runCampaignDemo(): Promise<void> {
  const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
  const rulebooks = {
    us: loadRulebook(`${ASSETS}rulebook.us.json`),
    eu: loadRulebook(`${ASSETS}rulebook.eu.json`),
    latam: loadRulebook(`${ASSETS}rulebook.latam.json`),
  };
  const campaign = demoCampaign();

  console.log(`\n# Campaign review board (local fake-Band demo, NOT legal advice)`);
  console.log(`# Campaign: "${campaign.name}" with ${campaign.materials.length} materials, all negotiated CONCURRENTLY.`);
  console.log(`# Shared dossier cascades into every reviewer of every material.\n`);

  const session = new CampaignSession({
    roomId: 'demo-campaign',
    campaign,
    brand,
    rulebooks,
    models: campaignModels(),
    perception: stubPerception(),
    onEvent: printEvent,
    onPrecedent: (p) => console.log(`  [precedent] ${JSON.stringify(p)}`),
  });

  const rollup = await session.run();

  // Any material that escalated rests at awaiting-decision; rule on it so the demo
  // shows the human-in-the-loop closing the campaign, per material.
  for (const m of rollup.perMaterial) {
    if (m.verdicts.some((v) => v.decision === 'escalate')) {
      console.log(`\n# Human rules on ${m.materialId}'s escalation:\n`);
      await session.submitDecision(m.materialId, 'Hold this material: drop "free forever" and resubmit with qualified pricing.');
    }
  }

  const finalRollup = session.rollup();
  console.log(`\n# Campaign rollup (observational; gates nothing):`);
  console.log(`  Worst-case per region: ${finalRollup.worstCaseByRegion.map((r) => `${r.region}=${r.decision}`).join(', ')}`);
  console.log(`  Material x region matrix:`);
  for (const cell of finalRollup.matrix) {
    console.log(`    ${cell.materialId.padEnd(14)} ${cell.region.padEnd(6)} ${cell.decision}`);
  }
}

// Legacy single-asset run, kept reachable for comparison: pnpm local single
async function runSingleDemo(): Promise<void> {
  const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
  const rulebooks = {
    us: loadRulebook(`${ASSETS}rulebook.us.json`),
    eu: loadRulebook(`${ASSETS}rulebook.eu.json`),
    latam: loadRulebook(`${ASSETS}rulebook.latam.json`),
  };
  const asset = loadAsset(`${ASSETS}sample-asset.json`);
  const models: BoardModels = {
    us: new StubModelClient(() => findings({ category: 'endorsement', severity: 'warn', claim: '9 out of 10 users felt healthier', rationale: 'Add a typical-results disclosure; substantiation is on file.', ruleId: 'us-testimonial' })),
    eu: new StubModelClient(() => findings(
      { category: 'health_claim', severity: 'block', claim: 'clinically proven to boost your immune system', rationale: 'Unauthorised health claim; not on the EU Register.', ruleId: 'eu-health-preauth' },
      { category: 'disclosure', severity: 'block', claim: 'whole asset', rationale: 'Missing Article 10(2) statements.', ruleId: 'eu-mandatory-disclosure', requiredDisclosure: 'Article 10(2) accompanying statements' },
    )),
    latam: new StubModelClient(() => findings({ category: 'localization', severity: 'block', claim: 'whole asset', rationale: 'Copy is not localized to Portuguese/Spanish.', ruleId: 'latam-localization', requiredDisclosure: 'Localized copy' })),
    brand: new StubModelClient(() => findings()),
    remediationCopy: new StubModelClient(() => ({ text: 'Immune+ apoia o seu bem-estar diario como parte de uma dieta variada e equilibrada e de um estilo de vida saudavel.' })),
    image: { model: 'stub-image', complete: async () => ({ text: '' }), generateImage: async () => ({ url: 'https://cdn.aimlapi.com/immune-latam.png' }) } satisfies ModelClient,
  };

  const events: BoardEvent[] = [];
  const session = new BoardSession({
    roomId: 'demo-room',
    asset,
    brand,
    rulebooks,
    models,
    onEvent: (e) => { events.push(e); printEvent(e); },
    onPrecedent: (p) => console.log(`  [precedent] ${JSON.stringify(p)}`),
  });

  console.log(`\n# Single-asset review board (local fake-Band demo, NOT legal advice)`);
  console.log(`# Asset: ${asset.id}; markets US/EU/LATAM + brand consistency\n`);
  await session.run();

  if (events.some((e) => e.type === 'status' && e.status === 'awaiting-decision')) {
    console.log(`\n# Human rules on the escalation:\n`);
    await session.submitDecision('Reject for EU: require authorised wording and Article 10(2) disclosures. US may publish with the typical-results disclosure.');
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('single')) {
    await runSingleDemo();
  } else {
    await runCampaignDemo();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
