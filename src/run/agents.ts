// Real runner: connects the review-board agents to band.ai and keeps the
// process alive. Create the room in app.band.ai, add these agents plus the human
// reviewer, then post a marketing asset @mentioning the coordinator.
//
//   pnpm agents     (needs the agent API keys + a model provider in .env)
//
// Agents: Coordinator, US, EU, LATAM (open model via Featherless), Brand,
// Reconcile, Remediation. Create a band.ai agent per role and set its
// PREFIX_AGENT_ID / PREFIX_API_KEY in .env.

import 'dotenv/config';
import { RealBandTransport } from '../band/real';
import { makeCoordinator } from '../agents/coordinator';
import { makeRegionReviewer } from '../agents/region-reviewer';
import { makeBrandReviewer } from '../agents/brand-reviewer';
import { makeRemediation } from '../agents/remediation';
import { makeReconcile } from '../agents/reconcile';
import { activeMode, describeRoutes, imageClientFor, modelFor } from '../models/route';
import { loadBrandDna, loadRulebook } from '../domain/load';

const ASSETS = new URL('../../assets/', import.meta.url).pathname;
const RECONCILE_HANDLE = '@pablomanjarres/reconcile';
const COORDINATOR_HANDLE = '@pablomanjarres/coordinator';

async function main(): Promise<void> {
  const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
  const usRules = loadRulebook(`${ASSETS}rulebook.us.json`);
  const euRules = loadRulebook(`${ASSETS}rulebook.eu.json`);
  const latamRules = loadRulebook(`${ASSETS}rulebook.latam.json`);

  console.log(`Model mode: ${activeMode()}`);
  console.log('Routes:', describeRoutes());

  const band = new RealBandTransport();

  await band.connectAgent({
    agentId: process.env.COORDINATOR_AGENT_ID ?? '',
    name: 'Coordinator',
    handle: COORDINATOR_HANDLE,
    envPrefix: 'COORDINATOR',
    onMessage: makeCoordinator(),
  });
  await band.connectAgent({
    agentId: process.env.US_AGENT_ID ?? '',
    name: 'US Reviewer',
    handle: '@pablomanjarres/us-reviewer',
    envPrefix: 'US',
    onMessage: makeRegionReviewer({ region: 'US', reviewerName: 'US Reviewer', rulebook: usRules, brand, model: modelFor('us'), reportToHandle: RECONCILE_HANDLE }),
  });
  await band.connectAgent({
    agentId: process.env.EU_AGENT_ID ?? '',
    name: 'EU Reviewer',
    handle: '@pablomanjarres/eu-reviewer',
    envPrefix: 'EU',
    onMessage: makeRegionReviewer({ region: 'EU', reviewerName: 'EU Reviewer', rulebook: euRules, brand, model: modelFor('eu'), reportToHandle: RECONCILE_HANDLE }),
  });
  await band.connectAgent({
    agentId: process.env.LATAM_AGENT_ID ?? '',
    name: 'LATAM Reviewer',
    handle: '@pablomanjarres/latam-reviewer',
    envPrefix: 'LATAM',
    onMessage: makeRegionReviewer({ region: 'LATAM', reviewerName: 'LATAM Reviewer', rulebook: latamRules, brand, model: modelFor('latam'), reportToHandle: RECONCILE_HANDLE }),
  });
  await band.connectAgent({
    agentId: process.env.BRAND_AGENT_ID ?? '',
    name: 'Brand Reviewer',
    handle: '@pablomanjarres/brand-reviewer',
    envPrefix: 'BRAND',
    onMessage: makeBrandReviewer({ brand, model: modelFor('brand'), reportToHandle: RECONCILE_HANDLE }),
  });
  await band.connectAgent({
    agentId: process.env.REMEDIATION_AGENT_ID ?? '',
    name: 'Remediation',
    handle: '@pablomanjarres/remediation',
    envPrefix: 'REMEDIATION',
    onMessage: makeRemediation({ brand, copyModel: modelFor('remediation'), imageModel: imageClientFor(), reportToHandle: COORDINATOR_HANDLE }),
  });
  await band.connectAgent({
    agentId: process.env.RECONCILE_AGENT_ID ?? '',
    name: 'Reconcile',
    handle: RECONCILE_HANDLE,
    envPrefix: 'RECONCILE',
    onMessage: makeReconcile({
      expectedRegions: ['US', 'EU', 'LATAM', 'BRAND'],
      coordinatorHandle: COORDINATOR_HANDLE,
      remediationHandle: '@pablomanjarres/remediation',
      ...(process.env.HUMAN_HANDLE ? { humanHandle: process.env.HUMAN_HANDLE } : {}),
    }),
  });

  console.log(
    'Agents connected to band.ai. In the room, @mention the coordinator with a marketing asset. Ctrl+C to stop.',
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
