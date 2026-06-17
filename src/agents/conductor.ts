// src/agents/conductor.ts
import type { AgentHandler } from '../band/types';
import type { ContentAsset } from '../domain/types';
import type { PodHub } from '../board/pod-hub';
import { matchParticipant } from './handles';
import { toAsset, tryParseAsset } from '../domain/load';

export interface ConductorOptions {
  podLeadHandles: string[];   // ['@claims-lead', '@reg-lead', '@brand-lead']
  primeHandles?: string[];    // e.g. ['@remediation'] so it caches the asset for later rewrites
  /**
   * Resolve a human's free-text reference to a saved campaign (for example
   * "@conductor review VitaBoost Focus") instead of pasting JSON. When set, a
   * human message also accepts a matched campaign, or raw copy as a fallback.
   */
  lookupCampaign?: (query: string) => ContentAsset | undefined;
  /** When set, stash the asset here and dispatch plain English (keeps the room readable). */
  hub?: PodHub;
  /**
   * Agent NAMES to pull into the room on kickoff via add_participant, so a human
   * only has to add the Conductor and post: the Conductor self-assembles the rest of
   * the cast. These are exact registered names (e.g. "US Reviewer"), because
   * add_participant matches by name and a hyphenated handle ("us-reviewer") does not.
   * Agents already present are skipped; a failure to add one is best-effort.
   */
  ensureAgents?: string[];
}

// Is an agent with this name already in the room? Match the exact name, or its
// hyphenated form against a participant handle (e.g. "US Reviewer" -> "us-reviewer").
function hasAgent(participants: { name: string; handle?: string | null }[], name: string): boolean {
  const n = name.toLowerCase();
  return participants.some(
    (p) => p.name.toLowerCase() === n || (p.handle ?? '').toLowerCase().includes(n.replace(/\s+/g, '-')),
  );
}

export function makeConductor(opts: ConductorOptions): AgentHandler {
  return async (message, tools) => {
    // A fresh asset, or a 'revised' asset coming back from remediation (the one loop).
    let asset: ContentAsset | null = tryParseAsset(message.content);
    if (!asset) {
      try {
        const b = JSON.parse(message.content) as { kind?: string; revised?: ContentAsset };
        if (b?.kind === 'revised' && b.revised) asset = b.revised;
      } catch { /* not JSON */ }
    }
    // A prose recommit from remediation: the revised asset is on the hub.
    if (!asset && message.senderType === 'agent') asset = opts.hub?.revised(message.roomId) ?? null;
    // A human can name a saved campaign (or paste raw copy) instead of JSON.
    if (!asset && message.senderType === 'user' && opts.lookupCampaign) {
      asset = opts.lookupCampaign(message.content) ?? toAsset(message.content);
    }
    if (!asset) return;

    opts.hub?.setAsset(message.roomId, asset);
    // Self-assemble: pull any missing cast member into the room so a human only needs
    // to add the Conductor and post. Present agents are skipped; failures are ignored.
    if (opts.ensureAgents?.length) {
      const present = await tools.getParticipants();
      // add_participant matches an agent by its exact registered NAME (case
      // insensitive), so ensureAgents holds names ("US Reviewer"), not handles.
      for (const name of opts.ensureAgents) {
        if (hasAgent(present, name)) continue;
        try {
          await tools.addParticipant(name, 'member');
          await tools.sendEvent(`Recruited ${name} into the room.`, 'recruited', {});
        } catch (err) {
          await tools.sendEvent(`Could not add ${name}: ${(err as Error)?.message ?? 'error'}`, 'log', {});
        }
      }
    }
    await tools.sendEvent(`Intake: dispatching ${asset.id} to ${opts.podLeadHandles.length} pods`, 'intake', { asset: asset.id });
    const participants = await tools.getParticipants();
    // With a hub the structured asset lives off-chat; dispatch plain English.
    const dispatch = opts.hub
      ? `Reviewing the "${asset.name ?? asset.id}" campaign for ${asset.markets.join(', ')} plus brand. Pods, please run your reviews.`
      : JSON.stringify(asset);
    // One message mentioning every pod lead (plus prime handles), not one each.
    const targets = [...opts.podLeadHandles, ...(opts.primeHandles ?? [])]
      .map((h) => matchParticipant(participants, h, 'agent'))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => ({ id: p.id, handle: p.handle }));
    if (targets.length) {
      // Guard the dispatch: a transient 422 (e.g. a just-added participant not yet
      // fully propagated) must not crash the handler and abort the whole review.
      try {
        await tools.sendMessage(dispatch, targets);
      } catch (err) {
        await tools.sendEvent(`Dispatch error: ${(err as Error)?.message ?? 'error'}`, 'error', {});
      }
    }
  };
}
