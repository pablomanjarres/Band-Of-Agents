import type { AgentHandler } from '../band/types';
import { toAsset, tryParseAsset } from '../domain/load';
import { nameMatchesHandle } from './handles';

export interface CoordinatorOptions {
  /**
   * band.ai room mode: also accept the asset when it is posted by this intake
   * agent (the UI relay), since the SDK can only post as an agent. In local mode
   * the asset arrives from a human user and this is left unset.
   */
  intakeAgentHandle?: string;
  /**
   * Accept a remediated (revised) asset from this agent as a re-intake. Closes
   * the adapt -> re-review loop: a fixed variant is reviewed again by the board
   * instead of being a one-shot output.
   */
  remediationHandle?: string;
}

/** Pull the revised ContentAsset out of a remediation `{kind:'revised'}` message. */
function revisedAssetJson(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as { kind?: string; revised?: unknown };
    if (parsed?.kind !== 'revised' || parsed.revised == null) return null;
    const json = JSON.stringify(parsed.revised);
    return tryParseAsset(json) ? json : null;
  } catch {
    return null;
  }
}

// The coordinator/chair. On an intake message (an asset posted into the room as
// JSON or natural copy, by a human or the configured intake agent), it normalizes
// the asset, recruits the reviewer agents present, and hands them the asset. It
// ignores other agent-to-agent chatter so reviewer replies do not retrigger it.
export function makeCoordinator(opts: CoordinatorOptions = {}): AgentHandler {
  return async (message, tools, ctx) => {
    const fromIntake =
      opts.intakeAgentHandle !== undefined &&
      message.senderType === 'agent' &&
      nameMatchesHandle(message.senderName, opts.intakeAgentHandle);
    const fromRemediation =
      opts.remediationHandle !== undefined &&
      message.senderType === 'agent' &&
      nameMatchesHandle(message.senderName, opts.remediationHandle);
    if (message.senderType === 'agent' && !fromIntake && !fromRemediation) return;

    // A revised asset from remediation is re-intaked (the re-review loop); any
    // other accepted message carries the asset directly.
    const assetContent = fromRemediation ? revisedAssetJson(message.content) : message.content;
    if (assetContent === null) return;

    const participants = await tools.getParticipants();
    const reviewers = participants.filter(
      (p) =>
        p.type === 'agent' &&
        p.id !== ctx.agentId &&
        !(opts.intakeAgentHandle !== undefined && nameMatchesHandle(p.name, opts.intakeAgentHandle)),
    );
    if (reviewers.length === 0) return;

    const asset = toAsset(assetContent);
    await tools.sendEvent(
      `${fromRemediation ? 'Re-review' : 'Intake'}: asset "${asset.id}" for ${asset.markets.join(', ')}. Recruiting ${reviewers.length} reviewer(s).`,
      'intake',
    );
    await tools.sendMessage(
      JSON.stringify(asset),
      reviewers.map((r) => ({ id: r.id, handle: r.handle })),
    );
  };
}
