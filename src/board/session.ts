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
import type { BrandDna, ContentAsset, Rulebook } from '../domain/types';
import { translateActivity, type BoardEvent } from './events';

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
}

export class BoardSession {
  private readonly room: FakeBandTransport;
  private emitSeq = 0;
  private started = false;
  private escalated = false;
  private decided = false;

  constructor(private readonly opts: BoardSessionOptions) {
    this.room = new FakeBandTransport(opts.roomId, {
      onActivity: (activity) => {
        const event = translateActivity(activity);
        if (event) this.emit(event);
      },
    });
  }

  /** Stamp a monotonic seq so the console can key/order events deterministically. */
  private emit(event: BoardEvent): void {
    if (event.type === 'escalation') this.escalated = true;
    if (event.type === 'decision') this.decided = true;
    this.opts.onEvent({ ...event, seq: this.emitSeq++ } as BoardEvent);
  }

  /** Connect the board, post the asset, and run the review to its first resting point. */
  async run(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const { asset, brand, rulebooks, models } = this.opts;
    const room = this.room;

    room.addUser('lead', 'Compliance Lead', '@compliance-lead');
    await room.connectAgent({ agentId: 'coord', name: 'Coordinator', handle: '@coordinator', onMessage: makeCoordinator({ remediationHandle: '@remediation' }) });
    await room.connectAgent({
      agentId: 'us',
      name: 'US Reviewer',
      handle: '@us-reviewer',
      onMessage: makeRegionReviewer({ region: 'US', reviewerName: 'US Reviewer', rulebook: rulebooks.us, brand, model: models.us, reportToHandle: '@reconcile', precedents: this.opts.getPrecedents }),
    });
    await room.connectAgent({
      agentId: 'eu',
      name: 'EU Reviewer',
      handle: '@eu-reviewer',
      onMessage: makeRegionReviewer({ region: 'EU', reviewerName: 'EU Reviewer', rulebook: rulebooks.eu, brand, model: models.eu, reportToHandle: '@reconcile', precedents: this.opts.getPrecedents }),
    });
    await room.connectAgent({
      agentId: 'latam',
      name: 'LATAM Reviewer',
      handle: '@latam-reviewer',
      onMessage: makeRegionReviewer({ region: 'LATAM', reviewerName: 'LATAM Reviewer', rulebook: rulebooks.latam, brand, model: models.latam, reportToHandle: '@reconcile', precedents: this.opts.getPrecedents }),
    });
    await room.connectAgent({
      agentId: 'brand',
      name: 'Brand Reviewer',
      handle: '@brand-reviewer',
      onMessage: makeBrandReviewer({ brand, model: models.brand, reportToHandle: '@reconcile' }),
    });
    await room.connectAgent({
      agentId: 'rem',
      name: 'Remediation',
      handle: '@remediation',
      onMessage: makeRemediation({ brand, copyModel: models.remediationCopy, imageModel: models.image, reportToHandle: '@coordinator', ...(this.opts.hostImage ? { hostImage: this.opts.hostImage } : {}) }),
    });
    await room.connectAgent({
      agentId: 'rec',
      name: 'Reconcile',
      handle: '@reconcile',
      onMessage: makeReconcile({
        expectedRegions: ['US', 'EU', 'LATAM', 'BRAND'],
        coordinatorHandle: '@coordinator',
        remediationHandle: '@remediation',
        humanHandle: '@compliance-lead',
        ...(this.opts.onPrecedent ? { logPrecedent: this.opts.onPrecedent } : {}),
      }),
    });

    this.emit({ type: 'intake', seq: 0, fromName: 'You', asset });
    this.emit({ type: 'status', seq: 0, fromName: 'system', status: 'running' });
    room.post('lead', JSON.stringify(asset), [{ id: 'coord' }]);
    await room.drain();
    this.emit({ type: 'status', seq: 0, fromName: 'system', status: this.escalated && !this.decided ? 'awaiting-decision' : 'complete' });
  }

  /** Record a human ruling on an escalation; logs precedent via Reconcile and completes. */
  async submitDecision(text: string): Promise<void> {
    this.room.post('lead', text, [{ id: 'rec' }]);
    await this.room.drain();
    this.emit({ type: 'status', seq: 0, fromName: 'system', status: 'complete' });
  }
}
