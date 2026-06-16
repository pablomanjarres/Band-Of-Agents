// Local end-to-end demos on the in-process fake transport, all key-free
// (stub models) and deterministic. Three runs are reachable:
//
//   npm run local            (default) concurrent MULTI-MATERIAL CAMPAIGN
//   npm run local single     one asset, the legacy single-asset board path
//   npm run local pods       the opt-in pods -> board -> spine topology
//
// Default (runCampaignDemo): one product (a shared dossier) with several
// marketing materials, each negotiated by the full US/EU/LATAM/BRAND + reconcile
// + remediation board CONCURRENTLY (not material-1 then material-2). It prints
// each material's events as they interleave and the final observational rollup
// (worst-case per region + the material x region matrix).
//
// pods (runPodsDemo): the Conductor fans the asset to three pods, the Regulatory
// pod debates (US passes, EU blocks and holds on rebuttal), each pod files one
// PodFinding, the Risk Adjudicator consults the Mediator, runs one remediation
// cycle that still fails, escalates to the human, and the human reject yields a
// terminal spiked. Swap in the real Band transport and real model clients
// (npm run agents) once credentials are wired.

import { FakeBandTransport } from '../band/fake';
import { BoardSession, type BoardModels } from '../board/session';
import { CampaignSession } from '../board/campaign';
import { connectPodBoardAgents, type PodBoardModels } from '../board/pod-board';
import { translateActivity, type BoardEvent } from '../board/events';
import { StubModelClient, type ModelClient } from '../models/client';
import { loadAsset, loadBrandDna, loadRulebook } from '../domain/load';
import { Campaign } from '../domain/types';
import { demoCampaignModels, demoPerception, findings } from './demo-fixtures';

const ASSETS = new URL('../../assets/', import.meta.url).pathname;

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

// A single block/warn/info finding for the pods demo stub models (severity +
// claim). Distinct from demo-fixtures' findings(), which takes Finding objects.
function podFinding(severity: 'block' | 'warn' | 'info', claim: string): { text: string; json: { findings: unknown[] } } {
  return { text: '', json: { findings: [{ category: 'claim', severity, claim, rationale: 'r' }] } };
}

// One product, THREE advertisements (each with its own materials), one shared
// dossier. The dossier is the cascading source-of-truth that grounds every
// reviewer of every material; every material across every ad negotiates
// concurrently (no ad-wide or campaign-wide gate).
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
    advertisements: [
      {
        id: 'hero-launch',
        name: 'Hero Launch',
        materials: [
          { id: 'hero-video', name: 'Hero Video', kind: 'video', channel: 'instagram', markets: ['US', 'EU', 'LATAM'], copy: 'Feel your best. Northwind Immune+ helps maintain your immune response. 9 out of 10 felt the difference.', claim: 'helps maintain immune response', videoUrl: '/api/videos/immune-plus-hero.mp4', perception: { frames: ['/api/images/immune-plus-frame-01.png', '/api/images/immune-plus-frame-02.png', '/api/images/immune-plus-frame-03.png', '/api/images/immune-plus-frame-04.png'] } },
          { id: 'hero-cutdown-post', name: 'Hero Cutdown Post', kind: 'post', channel: 'instagram', markets: ['US', 'EU', 'LATAM'], copy: '15 seconds to feeling your best. Northwind Immune+ supports everyday wellness as part of a balanced diet and healthy lifestyle.', claim: 'supports everyday wellness' },
          { id: 'hero-thumbnail-image', name: 'Hero Thumbnail', kind: 'image', channel: 'instagram', markets: ['US', 'EU', 'LATAM'], copy: 'Northwind Immune+: daily immune support.', claim: 'daily immune support' },
        ],
      },
      {
        id: 'retargeting',
        name: 'Retargeting',
        materials: [
          { id: 'retarget-video', name: 'Retargeting Cutdown', kind: 'video', channel: 'youtube', markets: ['US', 'EU', 'LATAM'], copy: 'Still thinking about it? Northwind Immune+ supports your everyday immune health, as part of a balanced diet and healthy lifestyle.', claim: 'supports everyday immune health' },
          { id: 'promo-banner', name: 'Promo Banner', kind: 'banner', channel: 'display', markets: ['US'], copy: 'Northwind Immune+: start your free trial today. Clinically supported immune support, delivered monthly.', claim: 'free trial; clinically supported immune support' },
        ],
      },
      {
        id: 'influencer',
        name: 'Influencer',
        materials: [
          { id: 'launch-post', name: 'Launch Post', kind: 'post', channel: 'x', markets: ['US', 'EU', 'LATAM'], copy: 'Northwind Immune+ supports everyday wellness as part of a balanced diet and healthy lifestyle.', claim: 'supports everyday wellness' },
          { id: 'influencer-story-image', name: 'Influencer Story', kind: 'image', channel: 'instagram', markets: ['US', 'EU', 'LATAM'], copy: 'My everyday wellness pick. Northwind Immune+ as part of a balanced diet and healthy lifestyle. #ad', claim: 'everyday wellness pick' },
        ],
      },
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
  const materialTotal = campaign.advertisements.reduce((n, ad) => n + ad.materials.length, 0);
  console.log(`# Campaign: "${campaign.name}" with ${campaign.advertisements.length} advertisements / ${materialTotal} materials, all negotiated CONCURRENTLY.`);
  console.log(`# Shared dossier cascades into every reviewer of every material.\n`);

  const session = new CampaignSession({
    roomId: 'demo-campaign',
    campaign,
    brand,
    rulebooks,
    models: demoCampaignModels(),
    perception: demoPerception(),
    onEvent: printEvent,
    onPrecedent: (p) => console.log(`  [precedent] ${JSON.stringify(p)}`),
  });

  const rollup = await session.run();

  // Any material that escalated rests at awaiting-decision; rule on it so the demo
  // shows the human-in-the-loop closing the campaign, per material.
  for (const m of rollup.perMaterial) {
    if (m.verdicts.some((v) => v.decision === 'escalate')) {
      console.log(`\n# Human rules on ${m.materialId}'s escalation:\n`);
      await session.submitDecision(m.materialId, 'Hold this material: drop the free-trial auto-renewal and resubmit with clear pricing terms.');
    }
  }

  const finalRollup = session.rollup();
  console.log(`\n# Campaign rollup (observational; gates nothing):`);
  console.log(`  Worst-case per region: ${finalRollup.worstCaseByRegion.map((r) => `${r.region}=${r.decision}`).join(', ')}`);
  console.log(`  Material x region matrix:`);
  for (const cell of finalRollup.matrix) {
    console.log(`    ${cell.advertisementId.padEnd(12)} ${cell.materialId.padEnd(22)} ${cell.region.padEnd(6)} ${cell.decision}`);
  }
  console.log(`  Per-advertisement worst-case:`);
  for (const ad of finalRollup.perAdvertisement) {
    console.log(`    ${ad.name.padEnd(14)} ${ad.worstCaseByRegion.map((r) => `${r.region}=${r.decision}`).join(', ')}`);
  }
}

// Legacy single-asset run, kept reachable for comparison: npm run local single
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

// Opt-in pods -> board -> spine run: npm run local pods
async function runPodsDemo(): Promise<void> {
  const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
  const usRules = loadRulebook(`${ASSETS}rulebook.us.json`);
  const euRules = loadRulebook(`${ASSETS}rulebook.eu.json`);
  const latamRules = loadRulebook(`${ASSETS}rulebook.latam.json`);
  const asset = loadAsset(`${ASSETS}sample-asset.json`);
  const claim = asset.claim;

  // Stub models so the full debate runs with no keys. Real runs route through
  // AIML (main) or Bedrock/Vertex/Featherless (dev) via the ModelClient seam.
  const pass: ModelClient = new StubModelClient(() => podFinding('info', claim));
  const empty: ModelClient = new StubModelClient(() => ({ text: '', json: { findings: [] } }));
  // EU blocks on review, then holds on rebuttal: a two-phase model keyed on call count.
  let euCall = 0;
  const euModel: ModelClient = new StubModelClient(() => (euCall++ % 2 === 0
    ? podFinding('block', claim)
    : { text: '', json: { stance: 'hold', rationale: 'unlawful' } }));
  const mediator: ModelClient = new StubModelClient(() => ({ text: '', json: { resolved: false, note: 'no movement', requiredDisclosure: null } }));
  const revised: ModelClient = new StubModelClient(() => ({ text: JSON.stringify({ ...asset, copy: 'softened' }) }));
  const image: ModelClient = { model: 'stub-image', complete: async () => ({ text: '' }), generateImage: async () => ({ url: 'https://cdn.aimlapi.com/stub-image.png' }) };

  const models: PodBoardModels = {
    scout: empty, claim: empty, precedent: empty, disclosure: empty,
    us: pass, eu: euModel, latam: pass,
    brand: empty, channel: empty, visual: empty,
    mediator, remediationCopy: revised, image,
  };

  const room = new FakeBandTransport('demo-room', {
    onActivity: (a) => {
      const e = translateActivity(a);
      if (e) console.log(`  [event] ${e.type} (${a.fromName}): ${a.content}`);
    },
  });
  room.addUser('lead', 'Compliance Lead', '@compliance-lead');
  await connectPodBoardAgents(room, { brand, rulebooks: { us: usRules, eu: euRules, latam: latamRules }, models });

  console.log(`\n# Pods -> board -> spine review (local fake-Band demo, NOT legal advice)`);
  console.log(`# Asset: ${asset.id}; markets US/EU/LATAM + brand consistency\n`);

  room.post('lead', JSON.stringify(asset), [{ id: 'cond' }]);
  await room.drain();

  room.post('lead', 'Reject: cannot publish in EU without authorization. US may publish with the typical-results disclosure.', [{ id: 'adj' }]);
  await room.drain();

  printTranscript(room);
}

function printTranscript(room: FakeBandTransport): void {
  console.log('\n--- room transcript ---');
  for (const t of room.transcript) {
    if (t.kind === 'event') {
      console.log(`  · ${t.fromName} (${t.messageType}): ${t.content}`);
    } else {
      const to = t.mentions.map((m) => m.handle ?? m.id).join(', ');
      const body = t.content.length > 150 ? `${t.content.slice(0, 150)}…` : t.content;
      console.log(`→ ${t.fromName} -> [${to}]: ${body}`);
    }
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('single')) {
    await runSingleDemo();
  } else if (process.argv.includes('pods')) {
    await runPodsDemo();
  } else {
    await runCampaignDemo();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
