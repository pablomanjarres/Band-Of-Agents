import type { AgentHandler } from '../band/types';
import type { ContentAsset } from '../domain/types';
import type { SharedBoard } from '../board/shared';
import { toAsset } from '../domain/load';
import { matchParticipant, nameMatchesHandle } from './handles';

export interface CoordinatorOptions {
  /** In-process data hub. The campaign is stashed here; the room stays plain English. */
  board: SharedBoard;
  /**
   * band.ai room mode: also accept the asset when it is posted by this intake
   * agent (the UI relay), since the SDK can only post as an agent. In local mode
   * the asset arrives from a human user and this is left unset.
   */
  intakeAgentHandle?: string;
  /**
   * Accept a re-submit from this remediation agent. Closes the adapt -> re-review
   * loop: a fixed variant is announced for re-review by the board instead of being
   * a one-shot output.
   */
  remediationHandle?: string;
  /** Handle of the reconcile agent the reviewers should report to. */
  reconcileHandle?: string;
  /**
   * Resolve a human's free-text reference to a saved campaign (e.g. "Coordinator,
   * review campaign Lumavida-Q3") by fetching it from the store. This is the
   * band.ai app flow: the human references a campaign stored in the UI and the
   * coordinator pulls it. Returns undefined to fall back to an inline campaign.
   */
  lookupCampaign?: (query: string) => ContentAsset | undefined;
}

// The coordinator/chair. It accepts an intake (from a human or the configured
// intake relay) or a re-submit (from remediation), stashes the campaign on the
// SharedBoard, and recruits the reviewer agents present with a single plain-
// English message pointing them at their rulebooks and the reconcile agent. The
// structured campaign lives on the board, never in the chat. It ignores reviewer
// chatter so their replies do not retrigger it.
export function makeCoordinator(opts: CoordinatorOptions): AgentHandler {
  return async (message, tools, ctx) => {
    const fromIntake =
      opts.intakeAgentHandle !== undefined &&
      message.senderType === 'agent' &&
      nameMatchesHandle(message.senderName, opts.intakeAgentHandle);
    const fromRemediation =
      opts.remediationHandle !== undefined &&
      message.senderType === 'agent' &&
      nameMatchesHandle(message.senderName, opts.remediationHandle);
    const fromHuman = message.senderType === 'user';
    if (!fromHuman && !fromIntake && !fromRemediation) return;

    const participants = await tools.getParticipants();
    // Recruit only the reviewer agents: exclude self, the intake relay, the
    // remediation agent, and the reconcile agent (reconcile is the report-to
    // target, not a reviewer, so it must not be told to review against a rulebook).
    const reviewers = participants.filter(
      (p) =>
        p.type === 'agent' &&
        p.id !== ctx.agentId &&
        !(opts.intakeAgentHandle !== undefined && nameMatchesHandle(p.name, opts.intakeAgentHandle)) &&
        !(opts.remediationHandle !== undefined && nameMatchesHandle(p.name, opts.remediationHandle)) &&
        !(opts.reconcileHandle !== undefined && nameMatchesHandle(p.name, opts.reconcileHandle)),
    );
    if (reviewers.length === 0) return;

    const reconcile =
      opts.reconcileHandle !== undefined
        ? matchParticipant(participants, opts.reconcileHandle, 'agent')
        : undefined;
    const reconcileTag = reconcile ? `@${reconcile.handle}` : '@Reconcile';
    const mentions = [
      ...reviewers.map((r) => ({ id: r.id, handle: r.handle })),
      ...(reconcile && !reviewers.some((r) => r.id === reconcile.id)
        ? [{ id: reconcile.id, handle: reconcile.handle }]
        : []),
    ];
    const reviewerTags = reviewers.map((r) => `@${r.handle}`).join(' ');

    if (fromRemediation) {
      // The remediation agent already called board.startReReview, so we only
      // re-recruit. Do not re-stash the campaign.
      await tools.sendEvent(`Re-review: re-recruiting ${reviewers.length} reviewer(s).`, 'intake');
      await tools.sendMessage(
        `Remediation sent back a revised version. ${reviewerTags}, please re-review and report to ${reconcileTag}.`,
        mentions,
      );
      return;
    }

    // Human/intake: resolve and stash the campaign, then recruit.
    const campaign = opts.lookupCampaign?.(message.content) ?? toAsset(message.content);
    opts.board.startReview(ctx.roomId, campaign);
    await tools.sendEvent(
      `Intake: "${campaignLabel(campaign)}" for ${campaign.markets.join(', ')}. Recruiting ${reviewers.length} reviewer(s).`,
      'intake',
    );
    await tools.sendMessage(
      `On it. Reviewing the "${campaignLabel(campaign)}" campaign for ${campaign.markets.join(', ')}. ${reviewerTags}, please review it against your rulebooks and report to ${reconcileTag}.`,
      mentions,
    );
  };
}

/** Prefer the human-friendly campaign name, falling back to the asset id. */
function campaignLabel(campaign: ContentAsset): string {
  return campaign.name ?? campaign.id;
}
