import type { AgentHandler, Participant } from '../band/types';
import type { ContentAsset } from '../domain/types';
import type { SharedBoard, StartReviewOptions } from '../board/shared';
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
   * review campaign Immune+ Q3") by fetching it from the store. This is the
   * band.ai app flow: the human references a campaign stored in the UI and the
   * coordinator pulls it. Returns undefined to fall back to an inline campaign.
   */
  lookupCampaign?: (query: string) => ContentAsset | undefined;
  /**
   * Campaign cascade for this review: the dossier and the campaign/material ids.
   * When set, the coordinator stashes them with the campaign so the per-key board,
   * reviewer (dossier in the prompt), and reconcile (per-material gate) operate on
   * this one material. Omitted for a plain single-asset review (no change).
   */
  startOptions?: StartReviewOptions;
  /**
   * band.ai CAMPAIGN mode: resolve the material posted into THIS room (by its room
   * id) to the asset under review plus its campaign cascade (dossier + campaign/ad/
   * material ids). A campaign is decomposed into one band.ai room per material, so
   * a single connected coordinator handles every material by looking the room up
   * here. When it returns a hit, that material and its startOptions win over the
   * single-asset `lookupCampaign`/`startOptions`, so the per-material dossier
   * cascade and the per-material reconcile gate engage for that room. Omitted (or a
   * miss) leaves the single-asset path unchanged.
   */
  lookupMaterial?: (roomId: string) => { asset: ContentAsset; startOptions: StartReviewOptions } | undefined;
  /**
   * Region code (US/EU/LATAM) -> the reviewer's configured handle. Recruitment is
   * then filtered to the asset's markets: a region reviewer joins only when its
   * market is targeted, and a targeted market with no agent present is pulled in
   * via addParticipant. Non-region reviewers (Brand) are always recruited. Omit
   * to recruit every present reviewer (the prior behavior).
   */
  regionHandles?: Record<string, string>;
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

    // band.ai CAMPAIGN mode: a campaign is one room per material, so resolve the
    // material posted into THIS room (and its dossier/campaign/ad/material ids).
    // A hit drives recruitment off the material's markets and engages the
    // per-material cascade + gate below; a miss is the unchanged single-asset path.
    const material = fromRemediation ? undefined : opts.lookupMaterial?.(ctx.roomId);

    // Resolve the campaign first so recruitment can target its markets. A
    // re-submit reuses the campaign already on the board; an intake or human
    // post carries it (a per-material lookup, a saved-campaign lookup, or inline JSON).
    const campaign = fromRemediation
      ? opts.board.campaign(ctx.roomId)
      : (material?.asset ?? opts.lookupCampaign?.(message.content) ?? toAsset(message.content));
    const markets = campaign?.markets ?? [];

    // Base pool: every agent in the room except this coordinator, the intake
    // relay, and the remediation agent.
    const candidates = participants.filter(
      (p) =>
        p.type === 'agent' &&
        p.id !== ctx.agentId &&
        !(opts.intakeAgentHandle !== undefined && nameMatchesHandle(p.name, opts.intakeAgentHandle)) &&
        !(opts.remediationHandle !== undefined && nameMatchesHandle(p.name, opts.remediationHandle)) &&
        !(opts.reconcileHandle !== undefined && nameMatchesHandle(p.name, opts.reconcileHandle)),
    );

    // Target the recruitment to the asset's markets: a region reviewer joins
    // only when its market is in scope, while non-region reviewers (Brand,
    // Reconcile) always do. With no regionHandles configured this is a no-op and
    // every present reviewer is recruited, as before.
    const regionHandles = opts.regionHandles ?? {};
    const regionOf = (p: Participant): string | undefined =>
      Object.keys(regionHandles).find(
        (code) =>
          nameMatchesHandle(p.name, regionHandles[code]!) || nameMatchesHandle(p.handle, regionHandles[code]!),
      );
    const reviewers = candidates.filter((p) => {
      const region = regionOf(p);
      return region === undefined || markets.includes(region);
    });

    // Dynamic recruitment: pull in a targeted market's reviewer that is not yet
    // in the room, so the room composes itself to the asset.
    for (const code of markets) {
      const handle = regionHandles[code];
      if (handle === undefined) continue;
      const present = participants.some(
        (p) => p.type === 'agent' && (nameMatchesHandle(p.name, handle) || nameMatchesHandle(p.handle, handle)),
      );
      if (present) continue;
      const segment = handle.replace(/^@/, '').split('/').pop() ?? handle;
      // band.ai participant role is a fixed enum; 'member' is valid, 'reviewer' 422s.
      await tools.addParticipant(segment, 'member');
      await tools.sendEvent(`Recruited the ${code} reviewer (${segment}) into the room for this asset.`, 'intake');
    }

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

    // Human/intake: the campaign is always resolved off this path. Stash it
    // (with the campaign cascade options when this is one material of a
    // campaign) and recruit.
    if (!campaign) return;
    opts.board.startReview(ctx.roomId, campaign, material?.startOptions ?? opts.startOptions);
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
