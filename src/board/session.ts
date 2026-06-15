// Board session: runs the full multi-region review for one asset over the Band
// transport seam and streams typed BoardEvents to a consumer (the server's SSE
// layer). It reuses the same agent factories as `pnpm local` / `pnpm agents`,
// so the console shows the real negotiation, not a reimplementation.
//
// In-process (FakeBandTransport) with real model clients gives a genuine
// multi-model review with no band.ai room plumbing. The band.ai room mode swaps
// the transport behind the same seam.

import { FakeBandTransport } from '../band/fake';
import { makeCoordinator } from '../agents/coordinator';
import { makeRegionReviewer } from '../agents/region-reviewer';
import { makeBrandReviewer } from '../agents/brand-reviewer';
import { makeRemediation } from '../agents/remediation';
import { makeReconcile, type Precedent } from '../agents/reconcile';
import type { ModelClient } from '../models/client';
import { imageClientFor, modelFor } from '../models/route';
import type { BrandDna, CampaignDossier, ContentAsset, Rulebook } from '../domain/types';
import { translateActivity, type BoardEvent } from './events';
import { SharedBoard } from './shared';

/** The model client each model-calling role uses for one session. */
export interface BoardModels {
  us: ModelClient;
  eu: ModelClient;
  latam: ModelClient;
  brand: ModelClient;
  remediationCopy: ModelClient;
  image: ModelClient;
}

/** Build the per-role clients from the active MODEL_MODE (aiml main / dev). */
export function realBoardModels(): BoardModels {
  return {
    us: modelFor('us'),
    eu: modelFor('eu'),
    latam: modelFor('latam'),
    brand: modelFor('brand'),
    remediationCopy: modelFor('remediation'),
    image: imageClientFor(),
  };
}

export interface BoardSessionOptions {
  roomId: string;
  asset: ContentAsset;
  brand: BrandDna;
  rulebooks: { us: Rulebook; eu: Rulebook; latam: Rulebook };
  models: BoardModels;
  onEvent: (event: BoardEvent) => void;
  onPrecedent?: (precedent: Precedent) => void;
  /** Host generated images (base64 -> short URL) so messages stay small. */
  hostImage?: (url: string) => string;
  /** Recent precedent lines fed into the region reviewers' shared context. */
  getPrecedents?: () => string[];
  /**
   * Campaign cascade for this review. When set, this BoardSession reviews ONE
   * material of a campaign: the dossier and the campaign/material ids are stashed
   * on the board (so the dossier shows up in every reviewer prompt) and the
   * material object is handed to the coordinator verbatim (so kind/perception are
   * not stripped). Omitting this is the unchanged single-asset path.
   */
  campaign?: {
    campaignId: string;
    materialId: string;
    dossier: CampaignDossier;
  };
}

export class BoardSession {
  private readonly room: FakeBandTransport;
  private readonly board: SharedBoard;
  private emitSeq = 0;
  private started = false;
  private terminal = false;

  constructor(private readonly opts: BoardSessionOptions) {
    // The agents share structured data here; band messages stay plain English.
    this.board = new SharedBoard((_roomId, event) => this.emit(event));
    this.room = new FakeBandTransport(opts.roomId, {
      onActivity: (activity) => {
        const event = translateActivity(activity);
        if (event) this.emit(event);
      },
    });
  }

  /** Stamp a monotonic seq so the console can key/order events deterministically. */
  private emit(event: BoardEvent): void {
    if (event.type === 'status' && event.status !== 'running') this.terminal = true;
    this.opts.onEvent({ ...event, seq: this.emitSeq++ } as BoardEvent);
  }

  /** Connect the board, post the asset, and run the review to its first resting point. */
  async run(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const { asset, brand, rulebooks, models } = this.opts;
    const room = this.room;
    const board = this.board;

    room.addUser('lead', 'Compliance Lead', '@compliance-lead');
    const campaignCtx = this.opts.campaign;
    await room.connectAgent({
      agentId: 'coord',
      name: 'Coordinator',
      handle: '@coordinator',
      onMessage: makeCoordinator({
        board,
        remediationHandle: '@remediation',
        reconcileHandle: '@reconcile',
        // Campaign mode: hand the material to the coordinator verbatim (a Material
        // is structurally a ContentAsset, so kind/perception survive) and stash the
        // dossier + ids so the cascade and per-material gate engage. Single-asset
        // mode leaves both unset, so the coordinator parses the posted asset as today.
        ...(campaignCtx
          ? {
              lookupCampaign: () => asset,
              startOptions: { dossier: campaignCtx.dossier, campaignId: campaignCtx.campaignId, materialId: campaignCtx.materialId },
            }
          : {}),
      }),
    });
    await room.connectAgent({
      agentId: 'us',
      name: 'US Reviewer',
      handle: '@us-reviewer',
      onMessage: makeRegionReviewer({ board, region: 'US', reviewerName: 'US Reviewer', rulebook: rulebooks.us, brand, model: models.us, reportToHandle: '@reconcile', precedents: this.opts.getPrecedents }),
    });
    await room.connectAgent({
      agentId: 'eu',
      name: 'EU Reviewer',
      handle: '@eu-reviewer',
      onMessage: makeRegionReviewer({ board, region: 'EU', reviewerName: 'EU Reviewer', rulebook: rulebooks.eu, brand, model: models.eu, reportToHandle: '@reconcile', precedents: this.opts.getPrecedents }),
    });
    await room.connectAgent({
      agentId: 'latam',
      name: 'LATAM Reviewer',
      handle: '@latam-reviewer',
      onMessage: makeRegionReviewer({ board, region: 'LATAM', reviewerName: 'LATAM Reviewer', rulebook: rulebooks.latam, brand, model: models.latam, reportToHandle: '@reconcile', precedents: this.opts.getPrecedents }),
    });
    await room.connectAgent({
      agentId: 'brand',
      name: 'Brand Reviewer',
      handle: '@brand-reviewer',
      onMessage: makeBrandReviewer({ board, brand, model: models.brand, reportToHandle: '@reconcile' }),
    });
    await room.connectAgent({
      agentId: 'rem',
      name: 'Remediation',
      handle: '@remediation',
      onMessage: makeRemediation({ board, brand, copyModel: models.remediationCopy, imageModel: models.image, reportToHandle: '@coordinator', ...(this.opts.hostImage ? { hostImage: this.opts.hostImage } : {}) }),
    });
    await room.connectAgent({
      agentId: 'rec',
      name: 'Reconcile',
      handle: '@reconcile',
      onMessage: makeReconcile({
        board,
        expectedRegions: ['US', 'EU', 'LATAM', 'BRAND'],
        coordinatorHandle: '@coordinator',
        remediationHandle: '@remediation',
        humanHandle: '@compliance-lead',
        ...(this.opts.onPrecedent ? { logPrecedent: this.opts.onPrecedent } : {}),
      }),
    });

    // The human posts the campaign; the Coordinator stashes it on the board and the
    // agents take it from there, emitting their own intake/review/verdict/status.
    room.post('lead', JSON.stringify(asset), [{ id: 'coord' }]);
    await room.drain();
    if (!this.terminal) this.emit({ type: 'status', seq: 0, fromName: 'system', status: 'complete' });
  }

  /** Record a human ruling on an escalation; logs precedent via Reconcile and completes. */
  async submitDecision(text: string): Promise<void> {
    this.terminal = false;
    this.room.post('lead', text, [{ id: 'rec' }]);
    await this.room.drain();
    if (!this.terminal) this.emit({ type: 'status', seq: 0, fromName: 'system', status: 'complete' });
  }
}
