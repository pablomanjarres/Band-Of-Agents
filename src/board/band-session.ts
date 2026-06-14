// band.ai room mode: band.ai's app is the entry point. You create a room in
// app.band.ai, add the agents, and post "Coordinator, review campaign <name>".
// The agents collaborate in that room, reading/writing our store (rulebooks,
// saved campaigns, verdicts, precedents). This backend only connects the agents
// and OBSERVES: it never creates rooms. Every review you start in band.ai is
// auto-discovered from the room's activity and streamed to the dashboard.

import { RealBandTransport } from '../band/real';
import type { BoardActivity } from '../band/types';
import { makeCoordinator } from '../agents/coordinator';
import { makeRegionReviewer } from '../agents/region-reviewer';
import { makeBrandReviewer } from '../agents/brand-reviewer';
import { makeRemediation } from '../agents/remediation';
import { makeReconcile, type Precedent } from '../agents/reconcile';
import type { BrandDna, ContentAsset, Rulebook } from '../domain/types';
import { translateActivity, type BoardEvent } from './events';
import type { BoardModels } from './session';

const COORDINATOR_HANDLE = '@pablomanjarres/coordinator';
const RECONCILE_HANDLE = '@pablomanjarres/reconcile';
const REMEDIATION_HANDLE = '@pablomanjarres/remediation';

export interface BandBoardOptions {
  brand: BrandDna;
  rulebooks: { us: Rulebook; eu: Rulebook; latam: Rulebook };
  models: BoardModels;
  humanHandle?: string;
  hostImage?: (url: string) => string;
  getPrecedents?: () => string[];
  /** Current rulebook per region from the store, so UI edits apply to the next review. */
  getRulebook?: (region: string) => Rulebook;
  /** Resolve a human's free-text reference to a saved campaign (the band.ai kickoff). */
  lookupCampaign?: (query: string) => ContentAsset | undefined;
  /** A human ruling on an escalation becomes precedent. */
  logPrecedent?: (precedent: Precedent) => void;
  /** Called when a review is first seen in a band.ai room; returns the event sink to stream into. */
  onReviewDiscovered: (roomId: string) => (event: BoardEvent) => void;
}

interface RoomBinding {
  onEvent: (event: BoardEvent) => void;
  escalated: boolean;
  decided: boolean;
}

export class BandBoard {
  private readonly transport: RealBandTransport;
  private started = false;
  private readonly rooms = new Map<string, RoomBinding>();

  constructor(private readonly opts: BandBoardOptions) {
    this.transport = new RealBandTransport({ onActivity: (a) => this.dispatch(a) });
  }

  /** Connect the agents so you can add them to a room in app.band.ai. We never create rooms. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const { brand, rulebooks, models } = this.opts;
    const rulebookFor = (region: 'us' | 'eu' | 'latam'): (() => Rulebook) => () =>
      this.opts.getRulebook?.(region.toUpperCase()) ?? rulebooks[region];

    await this.transport.connectAgent({
      agentId: requireEnv('COORDINATOR_AGENT_ID'),
      name: 'Coordinator',
      handle: COORDINATOR_HANDLE,
      envPrefix: 'COORDINATOR',
      onMessage: makeCoordinator({
        remediationHandle: REMEDIATION_HANDLE,
        ...(this.opts.lookupCampaign ? { lookupCampaign: this.opts.lookupCampaign } : {}),
      }),
    });
    await this.transport.connectAgent({
      agentId: requireEnv('US_AGENT_ID'),
      name: 'US Reviewer',
      handle: '@pablomanjarres/us-reviewer',
      envPrefix: 'US',
      onMessage: makeRegionReviewer({ region: 'US', reviewerName: 'US Reviewer', rulebook: rulebooks.us, brand, model: models.us, reportToHandle: RECONCILE_HANDLE, getRulebook: rulebookFor('us'), precedents: this.opts.getPrecedents }),
    });
    await this.transport.connectAgent({
      agentId: requireEnv('EU_AGENT_ID'),
      name: 'EU Reviewer',
      handle: '@pablomanjarres/eu-reviewer',
      envPrefix: 'EU',
      onMessage: makeRegionReviewer({ region: 'EU', reviewerName: 'EU Reviewer', rulebook: rulebooks.eu, brand, model: models.eu, reportToHandle: RECONCILE_HANDLE, getRulebook: rulebookFor('eu'), precedents: this.opts.getPrecedents }),
    });
    await this.transport.connectAgent({
      agentId: requireEnv('LATAM_AGENT_ID'),
      name: 'LATAM Reviewer',
      handle: '@pablomanjarres/latam-reviewer',
      envPrefix: 'LATAM',
      onMessage: makeRegionReviewer({ region: 'LATAM', reviewerName: 'LATAM Reviewer', rulebook: rulebooks.latam, brand, model: models.latam, reportToHandle: RECONCILE_HANDLE, getRulebook: rulebookFor('latam'), precedents: this.opts.getPrecedents }),
    });
    await this.transport.connectAgent({
      agentId: requireEnv('BRAND_AGENT_ID'),
      name: 'Brand Reviewer',
      handle: '@pablomanjarres/brand-reviewer',
      envPrefix: 'BRAND',
      onMessage: makeBrandReviewer({ brand, model: models.brand, reportToHandle: RECONCILE_HANDLE }),
    });
    await this.transport.connectAgent({
      agentId: requireEnv('REMEDIATION_AGENT_ID'),
      name: 'Remediation',
      handle: REMEDIATION_HANDLE,
      envPrefix: 'REMEDIATION',
      onMessage: makeRemediation({ brand, copyModel: models.remediationCopy, imageModel: models.image, reportToHandle: COORDINATOR_HANDLE, ...(this.opts.hostImage ? { hostImage: this.opts.hostImage } : {}) }),
    });
    await this.transport.connectAgent({
      agentId: requireEnv('RECONCILE_AGENT_ID'),
      name: 'Reconcile',
      handle: RECONCILE_HANDLE,
      envPrefix: 'RECONCILE',
      onMessage: makeReconcile({
        expectedRegions: ['US', 'EU', 'LATAM', 'BRAND'],
        coordinatorHandle: COORDINATOR_HANDLE,
        remediationHandle: REMEDIATION_HANDLE,
        ...(this.opts.humanHandle ? { humanHandle: this.opts.humanHandle } : {}),
        ...(this.opts.logPrecedent ? { logPrecedent: this.opts.logPrecedent } : {}),
      }),
    });
  }

  private dispatch(activity: BoardActivity): void {
    let binding = this.rooms.get(activity.roomId);
    if (!binding) {
      // A review just started in a band.ai room: register and stream it.
      binding = { onEvent: this.opts.onReviewDiscovered(activity.roomId), escalated: false, decided: false };
      this.rooms.set(activity.roomId, binding);
      binding.onEvent({ type: 'status', seq: 0, fromName: 'system', status: 'running' });
    }

    const event = translateActivity(activity);
    if (!event) return;
    if (event.type === 'escalation') binding.escalated = true;
    if (event.type === 'decision') binding.decided = true;
    binding.onEvent(event);

    // band.ai has no local drain, so derive terminal status from the verdict:
    // adapt is mid-flight (remediation + re-review follow), escalate awaits the
    // human (who rules in band.ai), all-publish is complete.
    if (event.type === 'verdict') {
      const decisions = event.verdicts.map((v) => v.decision);
      const status = decisions.includes('adapt')
        ? 'running'
        : decisions.includes('escalate')
          ? 'awaiting-decision'
          : 'complete';
      binding.onEvent({ type: 'status', seq: 0, fromName: 'system', status });
    }
    if (event.type === 'decision') {
      binding.onEvent({ type: 'status', seq: 0, fromName: 'system', status: 'complete' });
    }
  }
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required for band mode (BOARD_MODE=band)`);
  return value;
}
