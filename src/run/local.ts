// Local end-to-end demo of the full review board on the in-process fake
// transport. Runs the whole debate with stub models (no API keys), exercising
// all three outcome paths from the architecture: publish, adapt -> remediation
// (rewrite + regenerated image), and escalate -> human. Swap in the real Band
// transport and real model clients (pnpm agents) once credentials are wired.
//
//   pnpm local

import { FakeBandTransport } from '../band/fake';
import { makeCoordinator } from '../agents/coordinator';
import { makeRegionReviewer } from '../agents/region-reviewer';
import { makeBrandReviewer } from '../agents/brand-reviewer';
import { makeRemediation } from '../agents/remediation';
import { makeReconcile } from '../agents/reconcile';
import { StubModelClient, type ModelClient } from '../models/client';
import { loadAsset, loadBrandDna, loadRulebook } from '../domain/load';

const ASSETS = new URL('../../assets/', import.meta.url).pathname;

function findings(...items: unknown[]): { text: string; json: { findings: unknown[] } } {
  return { text: '', json: { findings: items } };
}

async function main(): Promise<void> {
  const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
  const usRules = loadRulebook(`${ASSETS}rulebook.us.json`);
  const euRules = loadRulebook(`${ASSETS}rulebook.eu.json`);
  const latamRules = loadRulebook(`${ASSETS}rulebook.latam.json`);
  const asset = loadAsset(`${ASSETS}sample-asset.json`);

  // Stub models so the full debate runs with no keys. Real runs route through
  // AIML (main) or Bedrock/Vertex (dev) via the ModelClient seam.
  const usModel = new StubModelClient(() =>
    findings({ category: 'endorsement', severity: 'warn', claim: '9 out of 10 users felt healthier', rationale: 'Add a typical-results disclosure; substantiation is on file.', ruleId: 'us-testimonial' }),
  );
  const euModel = new StubModelClient(() =>
    findings(
      { category: 'health_claim', severity: 'block', claim: 'clinically proven to boost your immune system', rationale: 'Unauthorised health claim; not on the EU Register.', ruleId: 'eu-health-preauth' },
      { category: 'disclosure', severity: 'block', claim: 'whole asset', rationale: 'Missing Article 10(2) statements.', ruleId: 'eu-mandatory-disclosure', requiredDisclosure: 'Article 10(2) accompanying statements' },
    ),
  );
  const latamModel = new StubModelClient(() =>
    findings({ category: 'localization', severity: 'block', claim: 'whole asset', rationale: 'Copy is not localized to Portuguese/Spanish.', ruleId: 'latam-localization', requiredDisclosure: 'Localized copy' }),
  );
  const brandModel = new StubModelClient(() => findings());
  const copyModel = new StubModelClient(() => ({
    text: 'Lumavida Immune+ apoia o seu bem-estar diario como parte de uma dieta variada e equilibrada e de um estilo de vida saudavel.',
  }));
  const imageModel: ModelClient = {
    model: 'stub-image',
    complete: async () => ({ text: '' }),
    generateImage: async () => ({ url: 'https://cdn.aimlapi.com/lumavida-latam.png' }),
  };

  const room = new FakeBandTransport('demo-room');
  room.addUser('lead', 'Compliance Lead', '@compliance-lead');
  await room.connectAgent({ agentId: 'coord', name: 'Coordinator', handle: '@coordinator', onMessage: makeCoordinator() });
  await room.connectAgent({ agentId: 'us', name: 'US Reviewer', handle: '@us-reviewer', onMessage: makeRegionReviewer({ region: 'US', reviewerName: 'US Reviewer', rulebook: usRules, brand, model: usModel, reportToHandle: '@reconcile' }) });
  await room.connectAgent({ agentId: 'eu', name: 'EU Reviewer', handle: '@eu-reviewer', onMessage: makeRegionReviewer({ region: 'EU', reviewerName: 'EU Reviewer', rulebook: euRules, brand, model: euModel, reportToHandle: '@reconcile' }) });
  await room.connectAgent({ agentId: 'latam', name: 'LATAM Reviewer', handle: '@latam-reviewer', onMessage: makeRegionReviewer({ region: 'LATAM', reviewerName: 'LATAM Reviewer', rulebook: latamRules, brand, model: latamModel, reportToHandle: '@reconcile' }) });
  await room.connectAgent({ agentId: 'brand', name: 'Brand Reviewer', handle: '@brand-reviewer', onMessage: makeBrandReviewer({ brand, model: brandModel, reportToHandle: '@reconcile' }) });
  await room.connectAgent({ agentId: 'rem', name: 'Remediation', handle: '@remediation', onMessage: makeRemediation({ brand, copyModel, imageModel, reportToHandle: '@coordinator' }) });
  await room.connectAgent({
    agentId: 'rec',
    name: 'Reconcile',
    handle: '@reconcile',
    onMessage: makeReconcile({
      expectedRegions: ['US', 'EU', 'LATAM', 'BRAND'],
      coordinatorHandle: '@coordinator',
      remediationHandle: '@remediation',
      humanHandle: '@compliance-lead',
      logPrecedent: (p) => console.log(`  [precedent] ${JSON.stringify(p)}`),
    }),
  });

  console.log(`\n# Multi-region review board (local fake-Band demo, NOT legal advice)`);
  console.log(`# Asset: ${asset.id}; markets US/EU/LATAM + brand consistency\n`);

  room.post('lead', JSON.stringify(asset), [{ id: 'coord' }]);
  await room.drain();

  room.post('lead', 'Reject for EU: require authorised wording and Article 10(2) disclosures. US may publish with the typical-results disclosure.', [{ id: 'rec' }]);
  await room.drain();

  printTranscript(room);
}

function printTranscript(room: FakeBandTransport): void {
  console.log('--- room transcript ---');
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

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
