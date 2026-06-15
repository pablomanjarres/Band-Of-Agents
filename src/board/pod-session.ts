// Pod board session: runs the pods -> board -> spine review for one asset over
// the Band transport seam and streams typed BoardEvents to a consumer (the
// server's SSE layer). It mirrors BoardSession's interface so the server can
// drive either topology, and reuses connectPodBoardAgents (the same cast as
// pnpm local / pnpm agents), so the console shows the real negotiation.

import { FakeBandTransport } from '../band/fake';
import { connectPodBoardAgents, type PodBoardModels } from './pod-board';
import type { BrandDna, ContentAsset, Rulebook } from '../domain/types';
import { translateActivity, type BoardEvent } from './events';

/** A human ruling folded into the rulebook after an escalation. */
export interface PodPrecedent {
  claim: string;
  decision: string;
  note: string;
}

export interface PodBoardSessionOptions {
  roomId: string;
  asset: ContentAsset;
  brand: BrandDna;
  rulebooks: { us: Rulebook; eu: Rulebook; latam: Rulebook };
  models: PodBoardModels;
  onEvent: (event: BoardEvent) => void;
  onPrecedent?: (precedent: PodPrecedent) => void;
  /** Host generated images (base64 -> short URL) so messages stay small. */
  hostImage?: (url: string) => string;
  /** Recent human-ruling precedents fed into the region reviewers' prompts. */
  getPrecedents?: () => string[];
  /** Read the live rulebook per region (UI overrides) so edits apply to the next review. */
  getRulebook?: (region: string) => Rulebook | undefined;
}

export class PodBoardSession {
  private readonly room: FakeBandTransport;
  private emitSeq = 0;
  private started = false;
  private terminal = false;
  private imgSeq = 0;
  /** Short placeholder URLs mapped to the hosted data URL, so base64 never enters prompts. */
  readonly hostedImages = new Map<string, string>();

  constructor(private readonly opts: PodBoardSessionOptions) {
    this.room = new FakeBandTransport(opts.roomId, {
      onActivity: (activity) => {
        const event = translateActivity(activity);
        if (event) this.emit(event);
      },
    });
  }

  /** Stamp a monotonic seq so the console can key/order events deterministically. */
  private emit(event: BoardEvent): void {
    // A terminal verdict or any non-running status is a resting point: do not
    // append an extra synthetic status afterwards.
    if (event.type === 'terminal' || (event.type === 'status' && event.status !== 'running')) this.terminal = true;
    this.opts.onEvent({ ...event, seq: this.emitSeq++ } as BoardEvent);
  }

  // Real image models (Nano Banana) return base64 data URLs hundreds of KB long.
  // If one lands in the revised asset, every re-review prompt embeds it and blows
  // past the model context limit. Swap it for a short URL before it propagates.
  private defaultHostImage = (dataUrl: string): string => {
    if (!dataUrl.startsWith('data:')) return dataUrl;
    const shortUrl = `https://images.local/${this.opts.roomId}/${++this.imgSeq}.png`;
    this.hostedImages.set(shortUrl, dataUrl);
    return shortUrl;
  };

  /** Connect the cast, post the asset, and run to the first resting point. */
  async run(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const { asset, brand, rulebooks, models } = this.opts;
    const room = this.room;

    room.addUser('lead', 'Compliance Lead', '@compliance-lead');
    await connectPodBoardAgents(room, {
      brand,
      rulebooks,
      models,
      // Always host images so a regenerated base64 image cannot explode re-review prompts.
      hostImage: this.opts.hostImage ?? this.defaultHostImage,
      ...(this.opts.onPrecedent ? { logPrecedent: this.opts.onPrecedent } : {}),
      ...(this.opts.getPrecedents ? { getPrecedents: this.opts.getPrecedents } : {}),
      ...(this.opts.getRulebook ? { getRulebook: this.opts.getRulebook } : {}),
    });

    // The human posts the asset; the Conductor fans it to the pods and the cast
    // takes it from there, emitting intake/workitem/debate/pod-finding/adjudication.
    room.post('lead', JSON.stringify(asset), [{ id: 'cond' }]);
    await room.drain();
    if (!this.terminal) this.emit({ type: 'status', seq: 0, fromName: 'system', status: 'complete' });
  }

  /** Record a human ruling on an escalation; the Adjudicator drives it terminal. */
  async submitDecision(text: string): Promise<void> {
    this.terminal = false;
    this.room.post('lead', text, [{ id: 'adj' }]);
    await this.room.drain();
    if (!this.terminal) this.emit({ type: 'status', seq: 0, fromName: 'system', status: 'complete' });
  }
}
