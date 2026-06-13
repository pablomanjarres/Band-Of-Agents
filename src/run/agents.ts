// Real runner: connects the review-board agents to band.ai and keeps the
// process alive. Create the room in app.band.ai, add these agents plus the human
// reviewer, then post the sample asset @mentioning the coordinator.
//
//   pnpm agents     (needs the agent API keys + a model provider in .env)
//
// Agents wired here match the ones created in band.ai: Coordinator, US, EU,
// Brand, Reconcile. A LATAM reviewer is a drop-in once a band.ai agent exists
// for it (rulebook is already in assets/rulebook.latam.json).

import 'dotenv/config';
import { RealBandTransport } from '../band/real';
import { makeCoordinator } from '../agents/coordinator';
import { makeRegionReviewer } from '../agents/region-reviewer';
import { makeBrandReviewer } from '../agents/brand-reviewer';
import { makeReconcile } from '../agents/reconcile';
import { activeMode, describeRoutes, modelFor } from '../models/route';
import { loadBrandDna, loadRulebook } from '../domain/load';

const ASSETS = new URL('../../assets/', import.meta.url).pathname;
const RECONCILE_HANDLE = '@pablomanjarres/reconcile';
const COORDINATOR_HANDLE = '@pablomanjarres/coordinator';

async function main(): Promise<void> {
  const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
  const usRules = loadRulebook(`${ASSETS}rulebook.us.json`);
  const euRules = loadRulebook(`${ASSETS}rulebook.eu.json`);

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
    onMessage: makeRegionReviewer({
      region: 'US',
      reviewerName: 'US Reviewer',
      rulebook: usRules,
      brand,
      model: modelFor('us'),
      reportToHandle: RECONCILE_HANDLE,
    }),
  });
  await band.connectAgent({
    agentId: process.env.EU_AGENT_ID ?? '',
    name: 'EU Reviewer',
    handle: '@pablomanjarres/eu-reviewer',
    envPrefix: 'EU',
    onMessage: makeRegionReviewer({
      region: 'EU',
      reviewerName: 'EU Reviewer',
      rulebook: euRules,
      brand,
      model: modelFor('eu'),
      reportToHandle: RECONCILE_HANDLE,
    }),
  });
  await band.connectAgent({
    agentId: process.env.BRAND_AGENT_ID ?? '',
    name: 'Brand Reviewer',
    handle: '@pablomanjarres/brand-reviewer',
    envPrefix: 'BRAND',
    onMessage: makeBrandReviewer({ brand, model: modelFor('brand'), reportToHandle: RECONCILE_HANDLE }),
  });
  await band.connectAgent({
    agentId: process.env.RECONCILE_AGENT_ID ?? '',
    name: 'Reconcile',
    handle: RECONCILE_HANDLE,
    envPrefix: 'RECONCILE',
    onMessage: makeReconcile({
      expectedRegions: ['US', 'EU', 'BRAND'],
      coordinatorHandle: COORDINATOR_HANDLE,
      ...(process.env.HUMAN_HANDLE ? { humanHandle: process.env.HUMAN_HANDLE } : {}),
    }),
  });

  console.log(
    'Agents connected to band.ai. In the room, @mention the coordinator with the sample asset (assets/sample-asset.json). Ctrl+C to stop.',
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
