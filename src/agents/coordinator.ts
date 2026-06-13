import type { AgentHandler } from '../band/types';
import { toAsset } from '../domain/load';

// The coordinator/chair. On an intake message from a human (an asset posted into
// the room, as JSON or natural copy), it normalizes the asset, recruits the
// reviewer agents present, and hands them the asset. It ignores agent-to-agent
// chatter so reviewer replies do not retrigger it.
export function makeCoordinator(): AgentHandler {
  return async (message, tools, ctx) => {
    if (message.senderType === 'agent') return;

    const participants = await tools.getParticipants();
    const reviewers = participants.filter((p) => p.type === 'agent' && p.id !== ctx.agentId);
    if (reviewers.length === 0) return;

    const asset = toAsset(message.content);
    await tools.sendEvent(
      `Intake: asset "${asset.id}" for ${asset.markets.join(', ')}. Recruiting ${reviewers.length} reviewer(s).`,
      'intake',
    );
    await tools.sendMessage(
      JSON.stringify(asset),
      reviewers.map((r) => ({ id: r.id, handle: r.handle })),
    );
  };
}
