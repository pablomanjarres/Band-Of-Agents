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
    // A human can name a saved campaign (or paste raw copy) instead of JSON.
    if (!asset && message.senderType === 'user' && opts.lookupCampaign) {
      asset = opts.lookupCampaign(message.content) ?? toAsset(message.content);
    }
    if (!asset) return;

    opts.hub?.setAsset(message.roomId, asset);
    await tools.sendEvent(`Intake: dispatching ${asset.id} to ${opts.podLeadHandles.length} pods`, 'intake', { asset: asset.id });
    const participants = await tools.getParticipants();
    // With a hub the structured asset lives off-chat; dispatch plain English.
    const dispatch = opts.hub
      ? `Reviewing the "${asset.name ?? asset.id}" campaign for ${asset.markets.join(', ')} plus brand. Pods, please run your reviews.`
      : JSON.stringify(asset);
    for (const handle of [...opts.podLeadHandles, ...(opts.primeHandles ?? [])]) {
      const t = matchParticipant(participants, handle, 'agent');
      if (t) await tools.sendMessage(dispatch, [{ id: t.id, handle: t.handle }]);
    }
  };
}
