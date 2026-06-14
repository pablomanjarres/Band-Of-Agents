// Standalone band.ai runner: connects the review-board agents to band.ai and
// keeps the process alive, logging the room's activity to the console. Create
// the room in app.band.ai, add these agents plus the human reviewer, then post
// "Coordinator, review campaign <name>" (or paste an asset) @mentioning the
// coordinator.
//
//   pnpm agents     (needs the agent API keys + a model provider in .env)
//
// This is the no-server path: same agents and SharedBoard as `pnpm serve`
// (BOARD_MODE=band), without the store/UI. For the full dashboard, use the
// server. Agents: Coordinator, US, EU, LATAM, Brand, Reconcile, Remediation.
// Create a band.ai agent per role and set its PREFIX_AGENT_ID / PREFIX_API_KEY.

import 'dotenv/config';
import { BandBoard } from '../board/band-session';
import { realBoardModels } from '../board/session';
import { activeMode, describeRoutes } from '../models/route';
import { loadBrandDna, loadRulebook } from '../domain/load';
import type { BoardEvent } from '../board/events';

const ASSETS = new URL('../../assets/', import.meta.url).pathname;

function logEvent(roomId: string, event: BoardEvent): void {
  const tag = `[${roomId}]`;
  switch (event.type) {
    case 'intake':
      console.log(`${tag} intake: "${event.asset.name ?? event.asset.id}" for ${event.asset.markets.join(', ')}`);
      break;
    case 'recruited':
    case 'progress':
    case 'log':
      console.log(`${tag} ${event.fromName}: ${event.text}`);
      break;
    case 'review':
      console.log(`${tag} ${event.reviewerName}: ${event.region} review, ${event.findings.length} finding(s), ${event.blocking} blocking`);
      break;
    case 'verdict':
      console.log(`${tag} verdict: ${event.verdicts.map((v) => `${v.region}=${v.decision}`).join(', ')}`);
      break;
    case 'revised':
      console.log(`${tag} revised ${event.region}: ${event.copy.slice(0, 60)}`);
      break;
    case 'escalation':
      console.log(`${tag} ESCALATION: ${event.text}`);
      break;
    case 'decision':
      console.log(`${tag} decision: ${event.text}`);
      break;
    case 'status':
      console.log(`${tag} [status: ${event.status}]`);
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

  console.log(`Model mode: ${activeMode()}`);
  console.log('Routes:', describeRoutes());

  const board = new BandBoard({
    brand,
    rulebooks,
    models: realBoardModels(),
    ...(process.env.HUMAN_HANDLE ? { humanHandle: process.env.HUMAN_HANDLE } : {}),
    onReviewDiscovered: (roomId) => (event) => logEvent(roomId, event),
  });
  await board.start();

  console.log(
    'Agents connected to band.ai. In the room, @mention the coordinator with a campaign name or asset. Ctrl+C to stop.',
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
