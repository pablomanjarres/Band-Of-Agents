// Local end-to-end demo of the full review board on the in-process fake
// transport, via BoardSession. Runs the whole debate with stub models (no API
// keys), exercising publish, adapt -> remediation (rewrite + regenerated image),
// and escalate -> human. The agents coordinate in plain English and share data
// via the in-process board; this prints the resulting board events.
//
//   pnpm local

import { BoardSession, type BoardModels } from '../board/session';
import { StubModelClient, type ModelClient } from '../models/client';
import { loadAsset, loadBrandDna, loadRulebook } from '../domain/load';
import type { BoardEvent } from '../board/events';

const ASSETS = new URL('../../assets/', import.meta.url).pathname;

function findings(...items: unknown[]): { text: string; json: { findings: unknown[] } } {
  return { text: '', json: { findings: items } };
}

function printEvent(e: BoardEvent): void {
  switch (e.type) {
    case 'intake':
      console.log(`  intake: "${e.asset.name ?? e.asset.id}" for ${e.asset.markets.join(', ')}`);
      break;
    case 'recruited':
    case 'progress':
    case 'log':
      console.log(`  ${e.fromName}: ${e.text}`);
      break;
    case 'review':
      console.log(`  ${e.reviewerName}: ${e.region} review, ${e.findings.length} finding(s), ${e.blocking} blocking`);
      break;
    case 'verdict':
      console.log(`  VERDICT: ${e.verdicts.map((v) => `${v.region}=${v.decision}`).join(', ')} (conflict=${e.conflict})`);
      break;
    case 'revised':
      console.log(`  REVISED ${e.region}: ${e.copy.slice(0, 60)} [image ${e.imageUrl ? 'yes' : 'no'}]`);
      break;
    case 'escalation':
      console.log(`  ESCALATION: ${e.text}`);
      break;
    case 'decision':
      console.log(`  DECISION: ${e.text}`);
      break;
    case 'status':
      console.log(`  [status: ${e.status}]`);
      break;
  }
}

async function main(): Promise<void> {
  const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
  const rulebooks = {
    us: loadRulebook(`${ASSETS}rulebook.us.json`),
    eu: loadRulebook(`${ASSETS}rulebook.eu.json`),
    latam: loadRulebook(`${ASSETS}rulebook.latam.json`),
  };
  const asset = loadAsset(`${ASSETS}sample-asset.json`);

  // Stub models so the full debate runs with no keys.
  const models: BoardModels = {
    us: new StubModelClient(() =>
      findings({ category: 'endorsement', severity: 'warn', claim: '9 out of 10 users felt healthier', rationale: 'Add a typical-results disclosure; substantiation is on file.', ruleId: 'us-testimonial' }),
    ),
    eu: new StubModelClient(() =>
      findings(
        { category: 'health_claim', severity: 'block', claim: 'clinically proven to boost your immune system', rationale: 'Unauthorised health claim; not on the EU Register.', ruleId: 'eu-health-preauth' },
        { category: 'disclosure', severity: 'block', claim: 'whole asset', rationale: 'Missing Article 10(2) statements.', ruleId: 'eu-mandatory-disclosure', requiredDisclosure: 'Article 10(2) accompanying statements' },
      ),
    ),
    latam: new StubModelClient(() =>
      findings({ category: 'localization', severity: 'block', claim: 'whole asset', rationale: 'Copy is not localized to Portuguese/Spanish.', ruleId: 'latam-localization', requiredDisclosure: 'Localized copy' }),
    ),
    brand: new StubModelClient(() => findings()),
    remediationCopy: new StubModelClient(() => ({ text: 'Lumavida Immune+ apoia o seu bem-estar diario como parte de uma dieta variada e equilibrada e de um estilo de vida saudavel.' })),
    image: { model: 'stub-image', complete: async () => ({ text: '' }), generateImage: async () => ({ url: 'https://cdn.aimlapi.com/lumavida-latam.png' }) } satisfies ModelClient,
  };

  const events: BoardEvent[] = [];
  const session = new BoardSession({
    roomId: 'demo-room',
    asset,
    brand,
    rulebooks,
    models,
    onEvent: (e) => {
      events.push(e);
      printEvent(e);
    },
    onPrecedent: (p) => console.log(`  [precedent] ${JSON.stringify(p)}`),
  });

  console.log(`\n# Multi-region review board (local fake-Band demo, NOT legal advice)`);
  console.log(`# Campaign: ${asset.id}; markets US/EU/LATAM + brand consistency\n`);
  await session.run();

  if (events.some((e) => e.type === 'status' && e.status === 'awaiting-decision')) {
    console.log(`\n# Human rules on the escalation:\n`);
    await session.submitDecision('Reject for EU: require authorised wording and Article 10(2) disclosures. US may publish with the typical-results disclosure.');
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
