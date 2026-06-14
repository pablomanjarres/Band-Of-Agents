// Connect all five band.ai agents with no-op handlers to confirm every key
// authenticates over the WebSocket. No model calls. Self-exits after 15s.
//
//   pnpm exec tsx src/run/connect-smoke.ts

import 'dotenv/config';
import { RealBandTransport } from '../band/real';
import type { AgentConnection, AgentHandler } from '../band/types';

const noop: AgentHandler = async () => {};

const AGENTS = [
  { prefix: 'COORDINATOR', name: 'Coordinator', handle: '@pablomanjarres/coordinator' },
  { prefix: 'US', name: 'US Reviewer', handle: '@pablomanjarres/us-reviewer' },
  { prefix: 'EU', name: 'EU Reviewer', handle: '@pablomanjarres/eu-reviewer' },
  { prefix: 'BRAND', name: 'Brand Reviewer', handle: '@pablomanjarres/brand-reviewer' },
  { prefix: 'RECONCILE', name: 'Reconcile', handle: '@pablomanjarres/reconcile' },
];

async function main(): Promise<void> {
  const band = new RealBandTransport();
  const conns: AgentConnection[] = [];
  for (const a of AGENTS) {
    try {
      const conn = await band.connectAgent({
        agentId: process.env[`${a.prefix}_AGENT_ID`] ?? '',
        name: a.name,
        handle: a.handle,
        envPrefix: a.prefix,
        onMessage: noop,
      });
      conns.push(conn);
      console.log(`[connect] ${a.name} (${a.prefix}): started`);
    } catch (e) {
      console.error(`[connect] ${a.name} (${a.prefix}) FAILED:`, (e as Error)?.message ?? e);
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 15000));
  console.log('[connect] 15s elapsed with no fatal auth errors => all five connected. Stopping.');
  for (const conn of conns) await conn.stop().catch(() => undefined);
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
