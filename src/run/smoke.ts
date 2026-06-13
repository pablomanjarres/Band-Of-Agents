// Minimal real band.ai connection smoke test: connect one agent (Coordinator)
// and confirm it authenticates over the WebSocket. No model calls. Self-exits.
//
//   pnpm exec tsx src/run/smoke.ts

import 'dotenv/config';
import { Agent, GenericAdapter, loadAgentConfigFromEnv } from '@band-ai/sdk';

async function main(): Promise<void> {
  const config = loadAgentConfigFromEnv({ prefix: 'COORDINATOR' });
  console.log('[smoke] loaded config for agent id:', config.agentId);

  const adapter = new GenericAdapter(async (raw: unknown): Promise<void> => {
    const args = raw as { message?: { content?: string; senderName?: string | null } };
    console.log('[smoke] inbound message:', args.message?.content ?? JSON.stringify(args).slice(0, 200));
  });

  const agent = Agent.create({ adapter, config });
  console.log('[smoke] connecting to band.ai ...');
  agent
    .run({ signals: false })
    .then(() => console.log('[smoke] run() resolved (agent stopped)'))
    .catch((e: unknown) => console.error('[smoke] run() error:', e));

  await new Promise((resolve) => setTimeout(resolve, 15000));
  console.log('[smoke] 15s elapsed without a fatal error; stopping.');
  await agent.stop().catch(() => undefined);
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error('[smoke] fatal:', e);
  process.exit(1);
});
