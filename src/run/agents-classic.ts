// Real runner for the CLASSIC review cast (Coordinator, US/EU/LATAM/Brand
// reviewers, Reconcile, Remediation, intake relay). This is the cast the web app
// and the campaign band flow (CampaignBandSession) expect: only Reconcile emits
// the per-region verdicts the dashboard renders. The pods runner (src/run/agents.ts)
// is a DIFFERENT topology (Conductor -> pods -> Mediator -> Adjudicator) that files
// pod findings and one terminal decision, not per-region verdicts, so a campaign
// review driven through the web stays on "reviewing" with the pods cast connected.
//
//   pnpm agents:classic        (needs the classic agents' keys in .env)
//
// Then, in app.band.ai: create a room, add these agents + the human reviewer, and
// post "Coordinator, review campaign <name>". Reconcile posts the verdicts back
// into the room. For the WEB-driven flow instead, run `pnpm serve:band` (the server
// connects this same cast and drives reviews from the portal).
//
// Cast (8 agents + the human), each a band.ai agent with PREFIX_AGENT_ID /
// PREFIX_API_KEY in .env: COORDINATOR, US, EU, LATAM, BRAND, RECONCILE,
// REMEDIATION, INTAKE. Pair with MODEL_MODE=vertex to run every agent on Vertex
// (one GCP credential, no AIML key and no AWS/Bedrock needed).

import 'dotenv/config';
import { BandBoard } from '../board/band-session';
import type { BoardModels } from '../board/session';
import { activeMode, describeRoutes, imageClientFor, modelFor } from '../models/route';
import { findCampaignByName, loadBrandDna, loadRulebook } from '../domain/load';
import { Store } from '../store/store';
import { spend } from '../models/spend';

const ASSETS = new URL('../../assets/', import.meta.url).pathname;
const DATA_DIR = new URL('../../data/', import.meta.url).pathname;

async function main(): Promise<void> {
  const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
  const usRules = loadRulebook(`${ASSETS}rulebook.us.json`);
  const euRules = loadRulebook(`${ASSETS}rulebook.eu.json`);
  const latamRules = loadRulebook(`${ASSETS}rulebook.latam.json`);

  console.log(`Model mode: ${activeMode()}`);
  console.log('Routes:', describeRoutes());

  // The classic cast needs only the region reviewers, brand, remediation copy, and
  // an image client (coordinator + reconcile are rule-based, no model).
  const models: BoardModels = {
    us: modelFor('us'),
    eu: modelFor('eu'),
    latam: modelFor('latam'),
    brand: modelFor('brand'),
    remediationCopy: modelFor('remediation'),
    image: imageClientFor(),
  };

  const store = new Store(DATA_DIR);
  const lookupCampaign = (query: string) => findCampaignByName(store.listAssets(), query);
  const getRulebook = (region: string) =>
    store.getRulebookOverride(region) ?? (region === 'US' ? usRules : region === 'EU' ? euRules : latamRules);
  const getPrecedents = () => store.listPrecedents().slice(-6).map((p) => `${p.regions.join('/')}: ${p.decision}`);

  const board = new BandBoard({
    brand,
    rulebooks: { us: usRules, eu: euRules, latam: latamRules },
    models,
    ...(process.env.HUMAN_HANDLE ? { humanHandle: process.env.HUMAN_HANDLE } : {}),
    getPrecedents,
    getRulebook,
    lookupCampaign,
    logPrecedent: (p) => store.appendPrecedent(p),
    // Standalone manual runner: the agents post their verdicts straight into the
    // band.ai room, so no dashboard sink is needed. We mirror the key structured
    // events to the console so the run is watchable from the terminal too. (The web
    // server supplies a real sink that streams to the dashboard.)
    onReviewDiscovered: (roomId) => (event) => {
      if (event.type === 'verdict') {
        const summary = event.verdicts.map((v) => `${v.region}=${v.decision}`).join(', ');
        console.log(`  [${roomId}] verdict: ${summary}${event.conflict ? ' (conflict)' : ''}`);
      } else if (event.type === 'escalation' || event.type === 'decision') {
        console.log(`  [${roomId}] ${event.type}: ${event.text}`);
      }
    },
  });

  await board.start();
  console.log(
    'Classic review agents connected to band.ai. In a room, add them + the human, then post ' +
      '"Coordinator, review campaign <name>". Ctrl+C to stop.',
  );

  // Live spend readout: print the running estimate whenever it moves.
  let lastUsd = -1;
  setInterval(() => {
    const s = spend.snapshot();
    if (s.totalUsd === lastUsd) return;
    lastUsd = s.totalUsd;
    const top = s.byModel.slice(0, 3).map((m) => `${m.model.split('/').pop()}: $${m.usd.toFixed(4)}`).join(', ');
    console.log(`[spend] est. $${s.totalUsd.toFixed(4)} over ${s.calls} call(s)${top ? ` | ${top}` : ''}`);
  }, 12000);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
