// Real runner: connects the pods -> board -> spine cast to band.ai and keeps the
// process alive. Create the room in app.band.ai, add these agents plus the human
// reviewer, then post a marketing asset @mentioning the Conductor.
//
//   pnpm agents     (needs each agent's API key + a model provider in .env)
//
// Cast (17 agents + the human): Conductor; the Claims pod (Scout, Claim &
// Evidence, Precedent, Disclosure) under a Claims Lead; the Regulatory pod (US,
// EU, LATAM) under a debating Reg Lead; the Brand pod (Brand Voice, Channel,
// Visual) under a Brand Lead; the board (Mediator, Remediation); and the Risk
// Adjudicator. Each agent is a band.ai agent with its own PREFIX_AGENT_ID /
// PREFIX_API_KEY in .env (see AGENT_ENV_PREFIX below for the prefix per role).

import 'dotenv/config';
import { RealBandTransport } from '../band/real';
import { connectPodBoardAgents, type PodBoardModels } from '../board/pod-board';
import type { AgentConnection, BandTransport, ConnectOptions } from '../band/types';
import { activeMode, describeRoutes, imageClientFor, modelFor } from '../models/route';
import { loadBrandDna, loadRulebook } from '../domain/load';

const ASSETS = new URL('../../assets/', import.meta.url).pathname;

// connectPodBoardAgents wires every agent with a fixed agentId. On real Band each
// of those identities is a distinct registered agent, so map the fixed agentId to
// the env prefix that holds its PREFIX_AGENT_ID / PREFIX_API_KEY.
const AGENT_ENV_PREFIX: Record<string, string> = {
  cond: 'CONDUCTOR',
  claimslead: 'CLAIMS_LEAD',
  scout: 'SCOUT',
  ce: 'CLAIM_EVIDENCE',
  prec: 'PRECEDENT',
  disc: 'DISCLOSURE',
  reglead: 'REG_LEAD',
  us: 'US',
  eu: 'EU',
  latam: 'LATAM',
  brandlead: 'BRAND_LEAD',
  bv: 'BRAND_VOICE',
  ch: 'CHANNEL',
  vis: 'VISUAL',
  med: 'MEDIATOR',
  rem: 'REMEDIATION',
  adj: 'ADJUDICATOR',
};

// Thin decorator: injects each agent's env-prefixed credentials (mirroring the
// per-agent envPrefix pattern) before delegating to the real transport, so the
// shared connectPodBoardAgents wiring runs unchanged against Band Cloud.
class CredentialedTransport implements BandTransport {
  constructor(private readonly inner: RealBandTransport) {}

  connectAgent(opts: ConnectOptions): Promise<AgentConnection> {
    const prefix = AGENT_ENV_PREFIX[opts.agentId];
    if (!prefix) return this.inner.connectAgent(opts);
    return this.inner.connectAgent({
      ...opts,
      agentId: process.env[`${prefix}_AGENT_ID`] ?? opts.agentId,
      envPrefix: prefix,
    });
  }
}

async function main(): Promise<void> {
  const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
  const usRules = loadRulebook(`${ASSETS}rulebook.us.json`);
  const euRules = loadRulebook(`${ASSETS}rulebook.eu.json`);
  const latamRules = loadRulebook(`${ASSETS}rulebook.latam.json`);

  console.log(`Model mode: ${activeMode()}`);
  console.log('Routes:', describeRoutes());

  const models: PodBoardModels = {
    scout: modelFor('scout'), claim: modelFor('claim'), precedent: modelFor('precedent'), disclosure: modelFor('disclosure'),
    us: modelFor('us'), eu: modelFor('eu'), latam: modelFor('latam'),
    brand: modelFor('brand'), channel: modelFor('channel'), visual: modelFor('visual'),
    mediator: modelFor('mediator'), remediationCopy: modelFor('remediation'), image: imageClientFor(),
  };

  const transport = new CredentialedTransport(new RealBandTransport());
  await connectPodBoardAgents(transport, {
    brand,
    rulebooks: { us: usRules, eu: euRules, latam: latamRules },
    models,
  });

  console.log(
    'Agents connected to band.ai. In the room, @mention the Conductor with a marketing asset. Ctrl+C to stop.',
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
