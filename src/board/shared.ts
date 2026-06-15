// Shared in-process review board. Because all the agents run in one process, the
// structured data (campaign, per-region findings, verdicts) lives here and the
// agents read/write it directly. band.ai messages are then pure plain-English
// coordination ("Reconcile, EU is done, I'm blocking on the missing Article
// 10(2) statement"), so the room reads like a team, not a JSON feed. The
// dashboard is fed by this board's events, not by parsing chat.

import type { CampaignDossier, ContentAsset, RegionVerdict, ReviewResult } from '../domain/types';
import type { BoardEvent } from './events';

interface RoomData {
  campaign: ContentAsset;
  reviews: Map<string, ReviewResult>;
  verdicts: RegionVerdict[];
  remediationRounds: number;
  /** Cascading campaign source-of-truth for this material's review, when part of a campaign. */
  dossier?: CampaignDossier;
  /** Campaign coordinates, set when this key is a material review inside a campaign. */
  campaignId?: string;
  materialId?: string;
}

export type BoardEmit = (roomId: string, event: BoardEvent) => void;

/**
 * Optional campaign context for a review. A single material is reviewed under one
 * board key, so passing these makes the existing per-key board, reconcile, and
 * reviewer logic operate per material with no change to their decision rules: the
 * per-key wait-gate in reconcile becomes per-material automatically.
 */
export interface StartReviewOptions {
  dossier?: CampaignDossier;
  campaignId?: string;
  materialId?: string;
}

export class SharedBoard {
  private readonly rooms = new Map<string, RoomData>();

  constructor(private readonly emit: BoardEmit) {}

  /**
   * Coordinator starts a review: stash the campaign and announce intake. When the
   * review is one material of a campaign, opts carries the cascading dossier and
   * the campaign/material ids; they are stashed on the room and attached to every
   * event emitted for this key. Omitting opts is the unchanged single-asset path.
   */
  startReview(roomId: string, campaign: ContentAsset, opts?: StartReviewOptions): void {
    const prior = this.rooms.get(roomId);
    this.rooms.set(roomId, {
      campaign,
      reviews: new Map(),
      verdicts: [],
      remediationRounds: prior?.remediationRounds ?? 0,
      ...(opts?.dossier !== undefined ? { dossier: opts.dossier } : {}),
      ...(opts?.campaignId !== undefined ? { campaignId: opts.campaignId } : {}),
      ...(opts?.materialId !== undefined ? { materialId: opts.materialId } : {}),
    });
    this.emit(roomId, { type: 'intake', seq: 0, fromName: 'Coordinator', asset: campaign, ...this.ref(roomId) });
    this.emit(roomId, { type: 'status', seq: 0, fromName: 'system', status: 'running', ...this.ref(roomId) });
  }

  /** Re-review round: swap in the remediated campaign and clear the prior findings. The dossier and campaign ids are preserved (same material). */
  startReReview(roomId: string, campaign: ContentAsset): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      this.startReview(roomId, campaign);
      return;
    }
    room.campaign = campaign;
    room.reviews = new Map();
    room.verdicts = [];
  }

  campaign(roomId: string): ContentAsset | undefined {
    return this.rooms.get(roomId)?.campaign;
  }

  /** The cascading campaign dossier for this key, when the review is part of a campaign. */
  dossier(roomId: string): CampaignDossier | undefined {
    return this.rooms.get(roomId)?.dossier;
  }

  /** The material id for this key, when the review is one material of a campaign. */
  materialId(roomId: string): string | undefined {
    return this.rooms.get(roomId)?.materialId;
  }

  /** Campaign coordinates for this key, spread into every emitted event so the UI can route per material. */
  private ref(roomId: string): { campaignId?: string; materialId?: string } {
    const room = this.rooms.get(roomId);
    if (!room) return {};
    return {
      ...(room.campaignId !== undefined ? { campaignId: room.campaignId } : {}),
      ...(room.materialId !== undefined ? { materialId: room.materialId } : {}),
    };
  }

  /** A reviewer files its findings; returns how many regions have reported so far. */
  addReview(roomId: string, review: ReviewResult): number {
    const room = this.rooms.get(roomId);
    if (!room) return 0;
    room.reviews.set(review.region, review);
    const blocking = review.findings.filter((f) => f.severity === 'block').length;
    this.emit(roomId, { type: 'review', seq: 0, fromName: review.reviewer, region: review.region, reviewerName: review.reviewer, findings: review.findings, blocking, ...this.ref(roomId) });
    return room.reviews.size;
  }

  reviews(roomId: string): ReviewResult[] {
    return [...(this.rooms.get(roomId)?.reviews.values() ?? [])];
  }

  reviewFor(roomId: string, region: string): ReviewResult | undefined {
    return this.rooms.get(roomId)?.reviews.get(region);
  }

  setVerdicts(roomId: string, verdicts: RegionVerdict[], conflict: boolean): void {
    const room = this.rooms.get(roomId);
    if (room) room.verdicts = verdicts;
    this.emit(roomId, { type: 'verdict', seq: 0, fromName: 'Reconcile', verdicts, conflict, ...this.ref(roomId) });
  }

  /**
   * Whether verdicts have already been recorded for the current review round.
   * Reconcile is pinged once per reviewer report (plus the recruit), so it uses
   * this to decide exactly once per round; startReReview clears it for the next.
   */
  hasVerdicts(roomId: string): boolean {
    return (this.rooms.get(roomId)?.verdicts.length ?? 0) > 0;
  }

  /** The verdicts reconcile recorded this round, so remediation adapts the regions it was told to. */
  verdicts(roomId: string): RegionVerdict[] {
    return [...(this.rooms.get(roomId)?.verdicts ?? [])];
  }

  remediationRounds(roomId: string): number {
    return this.rooms.get(roomId)?.remediationRounds ?? 0;
  }

  noteRemediation(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room) room.remediationRounds += 1;
  }

  setRevised(roomId: string, region: string, revised: ContentAsset): void {
    this.emit(roomId, {
      type: 'revised',
      seq: 0,
      fromName: 'Remediation',
      region,
      copy: revised.copy,
      ...(revised.imageUrl ? { imageUrl: revised.imageUrl } : {}),
      markets: revised.markets,
      ...this.ref(roomId),
    });
  }

  escalate(roomId: string): void {
    // The natural-language brief is the band.ai message; the dashboard just needs the state.
    this.emit(roomId, { type: 'status', seq: 0, fromName: 'system', status: 'awaiting-decision', ...this.ref(roomId) });
  }

  decided(roomId: string, text: string): void {
    this.emit(roomId, { type: 'decision', seq: 0, fromName: 'You', text, ...this.ref(roomId) });
    this.emit(roomId, { type: 'status', seq: 0, fromName: 'system', status: 'complete', ...this.ref(roomId) });
  }

  complete(roomId: string): void {
    this.emit(roomId, { type: 'status', seq: 0, fromName: 'system', status: 'complete', ...this.ref(roomId) });
  }
}
