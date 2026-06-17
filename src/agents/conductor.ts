// src/agents/conductor.ts
import type { AgentHandler, RoomTools } from '../band/types';
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
  lookupCampaign?: (query: string) => (ContentAsset | undefined) | Promise<ContentAsset | undefined>;
  /**
   * Resolve a campaign / advertisement to its LIST of materials, so a human can post
   * "review the <campaign> <advertisement>" and the Conductor reviews each material in
   * turn until all are done. Preferred over lookupCampaign when set; a single asset is
   * just a list of one. The Conductor reviews materials sequentially in the room.
   */
  lookupMaterials?: (query: string) => Promise<{ name: string; materials: ContentAsset[] } | undefined> | ({ name: string; materials: ContentAsset[] } | undefined);
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

// Per-room campaign queue: the materials still to review, and where we are.
interface ReviewQueue { name: string; materials: ContentAsset[]; index: number }

export function makeConductor(opts: ConductorOptions): AgentHandler {
  const queues = new Map<string, ReviewQueue>();

  // Pull any missing cast member into the room (best effort). Runs once at the start
  // of a campaign, not per material.
  const ensureCast = async (tools: RoomTools): Promise<void> => {
    if (!opts.ensureAgents?.length) return;
    const present = await tools.getParticipants();
    for (const name of opts.ensureAgents) {
      if (hasAgent(present, name)) continue;
      try {
        await tools.addParticipant(name, 'member');
        await tools.sendEvent(`Recruited ${name} into the room.`, 'recruited', {});
      } catch (err) {
        await tools.sendEvent(`Could not add ${name}: ${(err as Error)?.message ?? 'error'}`, 'log', {});
      }
    }
  };

  // Set the asset under review and fan it out to the pods.
  const dispatch = async (roomId: string, tools: RoomTools, asset: ContentAsset): Promise<void> => {
    opts.hub?.setAsset(roomId, asset);
    await tools.sendEvent(`Intake: dispatching ${asset.id} to ${opts.podLeadHandles.length} pods`, 'intake', { asset: asset.id });
    const participants = await tools.getParticipants();
    const msg = opts.hub
      ? `Reviewing the "${asset.name ?? asset.id}" campaign for ${asset.markets.join(', ')} plus brand. Pods, please run your reviews.`
      : JSON.stringify(asset);
    const targets = [...opts.podLeadHandles, ...(opts.primeHandles ?? [])]
      .map((h) => matchParticipant(participants, h, 'agent'))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => ({ id: p.id, handle: p.handle }));
    if (targets.length) {
      try {
        await tools.sendMessage(msg, targets);
      } catch (err) {
        await tools.sendEvent(`Dispatch error: ${(err as Error)?.message ?? 'error'}`, 'error', {});
      }
    }
  };

  // Review the queue's current material: clear the prior material's state, announce
  // which material this is, and dispatch.
  const reviewCurrent = async (roomId: string, tools: RoomTools, q: ReviewQueue): Promise<void> => {
    opts.hub?.resetReview(roomId);
    const material = q.materials[q.index];
    if (!material) return;
    if (q.materials.length > 1) {
      await tools.sendEvent(`Material ${q.index + 1} of ${q.materials.length}: "${material.name ?? material.id}"`, 'intake', { asset: material.id });
    }
    await dispatch(roomId, tools, material);
  };

  return async (message, tools) => {
    const roomId = message.roomId;
    const senderName = (message.senderName ?? '').toLowerCase();

    // 1) The Adjudicator signals a material's review reached a terminal -> advance the
    //    campaign queue to the next material, or finish.
    if (message.senderType === 'agent' && senderName.includes('adjudic') && /material review complete/i.test(message.content)) {
      const q = queues.get(roomId);
      if (!q) return; // a single, queue-less review: nothing to advance
      q.index += 1;
      if (q.index < q.materials.length) {
        await reviewCurrent(roomId, tools, q);
      } else {
        if (q.materials.length > 1) {
          await tools.sendEvent(`Campaign review complete: ${q.materials.length} material(s) reviewed.`, 'status', { status: 'complete' });
          try { await tools.sendMessage(`All ${q.materials.length} material(s) of "${q.name}" have been reviewed.`, []); } catch { /* room post is best effort */ }
        }
        queues.delete(roomId);
      }
      return;
    }

    // 2) A revised asset recommit: re-review the SAME material (no queue advance; the
    //    Adjudicator's next terminal advances it). Either an explicit {kind:'revised'}
    //    payload (any sender) or the hub's revised asset on a prose recommit (agent).
    let revised: ContentAsset | null = null;
    try {
      const b = JSON.parse(message.content) as { kind?: string; revised?: ContentAsset };
      if (b?.kind === 'revised' && b.revised) revised = b.revised;
    } catch { /* not JSON */ }
    if (!revised && message.senderType === 'agent') revised = opts.hub?.revised(roomId) ?? null;
    if (revised) {
      await dispatch(roomId, tools, revised);
      return;
    }

    // 3) A human posts a campaign / advertisement to review.
    if (message.senderType === 'user') {
      // Prefer the material-list resolver: review every material of the campaign /
      // advertisement, one at a time.
      if (opts.lookupMaterials) {
        const res = await opts.lookupMaterials(message.content);
        if (res && res.materials.length > 0) {
          const q: ReviewQueue = { name: res.name, materials: res.materials, index: 0 };
          queues.set(roomId, q);
          if (res.materials.length > 1) {
            await tools.sendEvent(`Reviewing "${res.name}": ${res.materials.length} materials, one at a time.`, 'intake', {});
          }
          await ensureCast(tools);
          await reviewCurrent(roomId, tools, q);
          return;
        }
      }
      // Fallback: a single saved campaign (or raw copy).
      const single = opts.lookupCampaign ? (await opts.lookupCampaign(message.content)) ?? toAsset(message.content) : tryParseAsset(message.content);
      if (single) {
        await ensureCast(tools);
        await dispatch(roomId, tools, single);
      }
      return;
    }
  };
}
