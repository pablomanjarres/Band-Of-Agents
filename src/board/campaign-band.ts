// Campaign review over the BAND transport. This is the band analog of
// CampaignSession (src/board/campaign.ts): it runs a whole Campaign as MANY
// concurrent per-material reviews, never a sequential pipeline, with NO
// campaign-wide or advertisement-wide gate. The difference from the local
// CampaignSession is WHERE the agents run: here a single set of agents is already
// connected to band.ai (the BandBoard), and each material is posted into its own
// band.ai room by the Intake. The connected coordinator/reviewers/reconcile/
// remediation run the existing single-asset band flow PER ROOM (one room per
// material), exactly the way the single-asset band flow works today, just fanned
// out across every material of every advertisement.
//
// THE ONE RULE: every material's room is created and posted up front, so all
// materials negotiate concurrently. Reconcile fires per material (per room). The
// only aggregation is the observational rollup computed from the per-material
// verdicts as they arrive (worst-case per region per advertisement, the per-ad
// matrix, and the campaign-wide rollup) via the SAME computeRollup the local
// session uses. It blocks nothing: a material in advertisement B can reach a
// verdict while a material in advertisement A is still mid-review or escalated.

import type { BandBoard } from './band-session';
import type { BoardEvent } from './events';
import { computeRollup, type CampaignRollup } from './campaign';
import type { IntakeControl } from '../band/types';
import type { Advertisement, Campaign, CampaignDossier, Material, RegionVerdict } from '../domain/types';

export interface CampaignBandSessionOptions {
  /** The connected BandBoard hosting the agents (already started). */
  board: BandBoard;
  /** Identifier for this campaign run; each material room is bound to a task id derived from it. */
  roomId: string;
  campaign: Campaign;
  /**
   * Optional scope: when set, only this advertisement's materials are posted
   * (still one concurrent room each, still no gate); the rollup then naturally
   * covers just that advertisement. Mirrors CampaignSession's scope.
   */
  advertisementId?: string;
  /** Every per-material event flows through here already tagged with campaignId/advertisementId/materialId. */
  onEvent: (event: BoardEvent) => void;
}

// A material id is only unique WITHIN an advertisement, so key everything by
// (adId, materialId), exactly like the local CampaignSession.
function compositeKey(advertisementId: string, materialId: string): string {
  return `${advertisementId}::${materialId}`;
}

/**
 * Drive a campaign review over band.ai: post each material into its own room and
 * observe the per-material negotiation, aggregating verdicts into the
 * observational rollup. Returns when every material has reached a terminal state
 * (complete / awaiting-decision / error). A material that escalates rests at
 * awaiting-decision without holding up any sibling; submitDecision drives its
 * human ruling into that material's room.
 */
export class CampaignBandSession {
  // band.ai room id per material composite key.
  private readonly roomOfKey = new Map<string, string>();
  // Which advertisement / material each composite key belongs to (for the rollup).
  private readonly adOfKey = new Map<string, string>();
  private readonly materialOfKey = new Map<string, string>();
  // Latest verdicts seen per composite key (a re-review replaces the prior round).
  private readonly verdictsByKey = new Map<string, RegionVerdict[]>();
  // Resolve when a material's room reaches a terminal status.
  private readonly terminalByKey = new Map<string, () => void>();
  // Completion order, so the rollup reads deterministically.
  private readonly completionOrder: string[] = [];
  private intake?: IntakeControl;

  constructor(private readonly opts: CampaignBandSessionOptions) {}

  /** The advertisements in scope (all, or just the scoped one). Mirrors CampaignSession. */
  private scopedAdvertisements(): Advertisement[] {
    const all = this.opts.campaign.advertisements;
    if (this.opts.advertisementId === undefined) return all;
    return all.filter((ad) => ad.id === this.opts.advertisementId);
  }

  /** The material ids that will be reviewed, in declared order (flattened across the scoped ads). */
  materialIds(): string[] {
    return this.scopedAdvertisements().flatMap((ad) => ad.materials.map((m) => m.id));
  }

  /**
   * Post every material (across the scoped ads) into its own band.ai room and await
   * them all (concurrently). Returns the observational rollup once every material
   * is terminal.
   */
  async run(): Promise<CampaignRollup> {
    const { board, campaign } = this.opts;
    this.intake = await board.intakeControl();
    const dossier = campaign.dossier;

    const runs = this.scopedAdvertisements().flatMap((ad) =>
      ad.materials.map((material) => this.runMaterial(ad, material, dossier)),
    );
    await Promise.all(runs);
    return this.rollup();
  }

  private async runMaterial(ad: Advertisement, material: Material, dossier: CampaignDossier): Promise<void> {
    const { board, campaign, roomId } = this.opts;
    const key = compositeKey(ad.id, material.id);
    this.adOfKey.set(key, ad.id);
    this.materialOfKey.set(key, material.id);

    // One band.ai room per material, bound to a task id that carries the campaign +
    // material coordinates. The intake mints it; the board observes it.
    const taskId = `${campaign.id}::${ad.id}::${material.id}`;
    const intake = this.intake!;
    const room = await intake.createRoom(taskId);
    this.roomOfKey.set(key, room);

    // The campaign coordinates this room's events carry, so the campaign-review SSE
    // lanes them per material (exactly like the local CampaignSession).
    const ref = { campaignId: campaign.id, advertisementId: ad.id, materialId: material.id };

    // Register the material the coordinator resolves for this room (asset + dossier
    // + ids), so the per-material dossier cascade and the per-material reconcile gate
    // engage, then a tagged sink that stamps every event with the campaign ref.
    board.registerMaterialRoom(room, {
      asset: material,
      startOptions: { dossier, ...ref },
    });
    const terminal = new Promise<void>((resolve) => this.terminalByKey.set(key, resolve));
    board.observeRoom(room, (event) => this.onMaterialEvent(key, room, { ...event, ...ref } as BoardEvent));

    // Add the reviewer agents to the room, then post the material @mentioning the
    // coordinator so the existing band flow runs for this one material.
    for (const agentId of board.reviewerAgentIds()) {
      await intake.addParticipant(room, agentId, 'reviewer');
    }
    const coord = board.coordinatorMention();
    await intake.addParticipant(room, coord.id, 'member');
    // Plain-English kickoff that uniquely identifies the material (the structured
    // material lives on the board, keyed by this room; the chat stays English).
    const text = `Coordinator, please review "${material.name ?? material.id}" (advertisement ${ad.name}, material ${material.id}) for the ${campaign.name} campaign.`;
    await intake.postMessage(room, text, [{ id: coord.id, handle: coord.handle }]);

    // Resolve when the room first rests (complete / awaiting-decision / error). The
    // room sink + material context are kept registered so a later human ruling on an
    // escalated material still routes here; dispose() releases them.
    await terminal;
  }

  /** Release every per-material room's sink + context. Call when the campaign review record is done/replaced. */
  dispose(): void {
    for (const room of this.roomOfKey.values()) this.opts.board.releaseRoom(room);
  }

  // Tag-and-forward every per-material event; snapshot verdicts and resolve the
  // material's terminal gate when its room rests (status != running).
  private onMaterialEvent(key: string, _room: string, event: BoardEvent): void {
    if (event.type === 'verdict') this.verdictsByKey.set(key, event.verdicts);
    if (event.type === 'status' && event.status !== 'running') {
      if (!this.completionOrder.includes(key)) this.completionOrder.push(key);
      // 'awaiting-decision' is terminal for the run gate (the material rests for a
      // human); a later 'complete' after a decision simply re-resolves (no-op).
      this.terminalByKey.get(key)?.();
    }
    this.opts.onEvent(event);
  }

  /**
   * Record a human ruling on one material's escalation, addressed by material id.
   * Posts the decision into that material's room (via the intake), so reconcile
   * sees it and logs precedent. Resolves the first material with that id.
   */
  async submitDecision(materialId: string, text: string): Promise<void> {
    for (const [key, mid] of this.materialOfKey) {
      if (mid === materialId) {
        await this.submitDecisionForKey(key, text);
        return;
      }
    }
  }

  /** Record a human ruling on one material's escalation, addressed by (adId, materialId). */
  async submitDecisionFor(advertisementId: string, materialId: string, text: string): Promise<void> {
    await this.submitDecisionForKey(compositeKey(advertisementId, materialId), text);
  }

  private async submitDecisionForKey(key: string, text: string): Promise<void> {
    const room = this.roomOfKey.get(key);
    if (!room || !this.intake) return;
    const reconcile = this.opts.board.reconcileMention();
    // The human ruling is posted into the material's room, @mentioning reconcile.
    // Reconcile accepts it via its humanProxyHandle (the intake relay), records
    // precedent, and completes the room. It touches no other material's room.
    await this.intake.postMessage(room, text, [{ id: reconcile.id, handle: reconcile.handle }]);
  }

  /** The observational rollup over the verdicts seen so far. Same shape as CampaignSession. */
  rollup(): CampaignRollup {
    const ordered = this.completionOrder.filter((key) => this.verdictsByKey.has(key));
    const seen = new Set(ordered);
    for (const key of this.verdictsByKey.keys()) if (!seen.has(key)) ordered.push(key);
    const perMaterial = ordered.map((key) => ({
      advertisementId: this.adOfKey.get(key) ?? '',
      materialId: this.materialOfKey.get(key) ?? key,
      verdicts: this.verdictsByKey.get(key) ?? [],
    }));
    const adOrder = this.scopedAdvertisements().map((ad) => ({ id: ad.id, name: ad.name }));
    return computeRollup(this.opts.campaign.id, perMaterial, adOrder);
  }
}
