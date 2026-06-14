// band.ai room mode: band.ai's app is the entry point. You create a room in
// app.band.ai, add the agents, and post "Coordinator, review campaign <name>".
// The agents collaborate in that room in PLAIN ENGLISH, sharing the structured
// data in-process via a SharedBoard, and reading/writing our store (rulebooks,
// saved campaigns, verdicts, precedents). This backend only connects the agents
// and OBSERVES: it never creates rooms. The dashboard is fed by the SharedBoard
// (structured) plus the room's plain-English chatter (timeline).

import { RealBandTransport } from '../band/real';
import type { BoardActivity } from '../band/types';
import { makeCoordinator } from '../agents/coordinator';
import { makeRegionReviewer } from '../agents/region-reviewer';
import { makeBrandReviewer } from '../agents/brand-reviewer';
import { makeRemediation } from '../agents/remediation';
import { makeReconcile, type Precedent } from '../agents/reconcile';
import { buildCrossFrameworkAdapter, CROSS_FRAMEWORK_BRAND_PROMPT } from '../band/cross-framework';
import type { BrandDna, ContentAsset, Rulebook } from '../domain/types';
import type { NewArtifact } from '../domain/artifact';
import { translateActivity, type BoardEvent } from './events';
import { SharedBoard } from './shared';
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
  /** Register an artifact and get a dashboard viewer URL agents paste into the room. */
  publishArtifact?: (input: NewArtifact) => { id: string; url: string };
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
}

export class BandBoard {
  private readonly transport: RealBandTransport;
  private readonly board: SharedBoard;
  private started = false;
  private readonly rooms = new Map<string, RoomBinding>();

  constructor(private readonly opts: BandBoardOptions) {
    this.transport = new RealBandTransport({ onActivity: (a) => this.dispatch(a) });
    this.board = new SharedBoard((roomId, event) => this.routeEvent(roomId, event));
  }

  /** Connect the agents so you can add them to a room in app.band.ai. We never create rooms. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const { brand, rulebooks, models } = this.opts;
    const board = this.board;
    const rulebookFor = (region: 'us' | 'eu' | 'latam'): (() => Rulebook) => () =>
      this.opts.getRulebook?.(region.toUpperCase()) ?? rulebooks[region];

    await this.transport.connectAgent({
      agentId: requireEnv('COORDINATOR_AGENT_ID'),
      name: 'Coordinator',
      handle: COORDINATOR_HANDLE,
      envPrefix: 'COORDINATOR',
      onMessage: makeCoordinator({
        board,
        remediationHandle: REMEDIATION_HANDLE,
        reconcileHandle: RECONCILE_HANDLE,
        // Recruit only the reviewers the asset's markets target (Brand always joins).
        regionHandles: {
          US: '@pablomanjarres/us-reviewer',
          EU: '@pablomanjarres/eu-reviewer',
          LATAM: '@pablomanjarres/latam-reviewer',
        },
        ...(this.opts.lookupCampaign ? { lookupCampaign: this.opts.lookupCampaign } : {}),
      }),
    });
    await this.transport.connectAgent({
      agentId: requireEnv('US_AGENT_ID'),
      name: 'US Reviewer',
      handle: '@pablomanjarres/us-reviewer',
      envPrefix: 'US',
      onMessage: makeRegionReviewer({ board, region: 'US', reviewerName: 'US Reviewer', rulebook: rulebooks.us, brand, model: models.us, reportToHandle: RECONCILE_HANDLE, getRulebook: rulebookFor('us'), precedents: this.opts.getPrecedents }),
    });
    await this.transport.connectAgent({
      agentId: requireEnv('EU_AGENT_ID'),
      name: 'EU Reviewer',
      handle: '@pablomanjarres/eu-reviewer',
      envPrefix: 'EU',
      onMessage: makeRegionReviewer({ board, region: 'EU', reviewerName: 'EU Reviewer', rulebook: rulebooks.eu, brand, model: models.eu, reportToHandle: RECONCILE_HANDLE, getRulebook: rulebookFor('eu'), precedents: this.opts.getPrecedents }),
    });
    await this.transport.connectAgent({
      agentId: requireEnv('LATAM_AGENT_ID'),
      name: 'LATAM Reviewer',
      handle: '@pablomanjarres/latam-reviewer',
      envPrefix: 'LATAM',
      onMessage: makeRegionReviewer({ board, region: 'LATAM', reviewerName: 'LATAM Reviewer', rulebook: rulebooks.latam, brand, model: models.latam, reportToHandle: RECONCILE_HANDLE, getRulebook: rulebookFor('latam'), precedents: this.opts.getPrecedents }),
    });
    await this.transport.connectAgent({
      agentId: requireEnv('BRAND_AGENT_ID'),
      name: 'Brand Reviewer',
      handle: '@pablomanjarres/brand-reviewer',
      envPrefix: 'BRAND',
      onMessage: makeBrandReviewer({ board, brand, model: models.brand, reportToHandle: RECONCILE_HANDLE }),
    });
    await this.transport.connectAgent({
      agentId: requireEnv('REMEDIATION_AGENT_ID'),
      name: 'Remediation',
      handle: REMEDIATION_HANDLE,
      envPrefix: 'REMEDIATION',
      onMessage: makeRemediation({ board, brand, copyModel: models.remediationCopy, imageModel: models.image, reportToHandle: COORDINATOR_HANDLE, ...(this.opts.hostImage ? { hostImage: this.opts.hostImage } : {}), ...(this.opts.publishArtifact ? { publishArtifact: this.opts.publishArtifact } : {}) }),
    });
    await this.transport.connectAgent({
      agentId: requireEnv('RECONCILE_AGENT_ID'),
      name: 'Reconcile',
      handle: RECONCILE_HANDLE,
      envPrefix: 'RECONCILE',
      onMessage: makeReconcile({
        board,
        expectedRegions: ['US', 'EU', 'LATAM', 'BRAND'],
        // Wait only for the market-bound regions the asset targets; Brand is always expected.
        marketRegions: ['US', 'EU', 'LATAM'],
        coordinatorHandle: COORDINATOR_HANDLE,
        remediationHandle: REMEDIATION_HANDLE,
        ...(this.opts.humanHandle ? { humanHandle: this.opts.humanHandle } : {}),
        ...(this.opts.logPrecedent ? { logPrecedent: this.opts.logPrecedent } : {}),
        ...(this.opts.publishArtifact ? { publishArtifact: this.opts.publishArtifact } : {}),
      }),
    });

    // Cross-framework advisor (opt-in via XFRAMEWORK_AGENT_ID + AIML_API_KEY): one
    // reviewer running on the SDK's OpenAI tool-calling framework instead of the
    // GenericAdapter, so the room visibly spans frameworks, not just models. It
    // coordinates via the room tools (narrates a thought, posts a brand-voice
    // finding, @mentions reconcile); it does not file a structured board verdict.
    if (process.env.XFRAMEWORK_AGENT_ID && process.env.AIML_API_KEY) {
      await this.transport.connectFrameworkAgent({
        name: 'Brand Voice (OpenAI framework)',
        envPrefix: 'XFRAMEWORK',
        adapter: buildCrossFrameworkAdapter({
          apiKey: process.env.AIML_API_KEY,
          systemPrompt: CROSS_FRAMEWORK_BRAND_PROMPT,
        }),
      });
    }
  }

  /** Plain-English room chatter -> timeline log lines. Structured diagram state comes from the board. */
  private dispatch(activity: BoardActivity): void {
    const event = translateActivity(activity);
    if (event) this.routeEvent(activity.roomId, event);
  }

  /** Route a board/chatter event to the dashboard, auto-discovering the review on first activity. */
  private routeEvent(roomId: string, event: BoardEvent): void {
    let binding = this.rooms.get(roomId);
    if (!binding) {
      binding = { onEvent: this.opts.onReviewDiscovered(roomId) };
      this.rooms.set(roomId, binding);
    }
    binding.onEvent(event);
  }
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required for band mode (BOARD_MODE=band)`);
  return value;
}
