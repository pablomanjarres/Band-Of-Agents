// Live probe for band.ai room mode: connect the Intake agent and confirm we can
// drive a room proactively via its REST facade (agent.runtime.link.rest):
// create a room, add a participant, and post a message. This de-risks the band
// mode wiring before building it.
//
//   pnpm exec tsx src/run/intake-probe.ts

import 'dotenv/config';
import { Agent, GenericAdapter, loadAgentConfigFromEnv } from '@band-ai/sdk';

interface RestLike {
  createChat?: (taskId?: string) => Promise<{ id: string }>;
  addChatParticipant?: (chatId: string, p: { participantId: string; role: string }) => Promise<unknown>;
  createChatMessage?: (
    chatId: string,
    m: { content: string; messageType?: string; mentions?: { id: string; handle?: string; name?: string }[] },
  ) => Promise<unknown>;
}

function restOf(agent: unknown): RestLike | undefined {
  return (agent as { runtime?: { link?: { rest?: RestLike } } })?.runtime?.link?.rest;
}

async function main(): Promise<void> {
  const config = loadAgentConfigFromEnv({ prefix: 'INTAKE' });
  console.log('Intake agentId:', config.agentId);
  const agent = Agent.create({ adapter: new GenericAdapter(async () => {}), config });
  void agent.run({ signals: false });
  await new Promise((r) => setTimeout(r, 2500));

  const rest = restOf(agent);
  console.log('rest facade present:', !!rest, rest ? Object.keys(rest as object) : '(none)');
  if (!rest?.createChat) {
    console.log('createChat not found on agent.runtime.link.rest; need an alternate access path.');
    process.exit(2);
  }

  const room = await rest.createChat();
  console.log('createChat ->', room);

  const coordId = process.env.COORDINATOR_AGENT_ID;
  if (rest.addChatParticipant && coordId) {
    await rest.addChatParticipant(room.id, { participantId: coordId, role: 'member' });
    console.log('addChatParticipant(coordinator) ok');
  }
  if (rest.createChatMessage) {
    await rest.createChatMessage(room.id, {
      content: 'probe: intake can post into a room',
      mentions: coordId ? [{ id: coordId, handle: '@pablomanjarres/coordinator', name: 'Coordinator' }] : [],
    });
    console.log('createChatMessage ok');
  }
  console.log('PROBE OK room=' + room.id);
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error('PROBE ERROR', e);
  process.exit(1);
});
