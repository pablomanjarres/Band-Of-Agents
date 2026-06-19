// band.ai room mode: band.ai's app is the entry point. You create a room in
// app.band.ai, add the agents, and post "Coordinator, review campaign <name>".
// The agents collaborate in that room in PLAIN ENGLISH, sharing the structured
// data in-process via a SharedBoard, and reading/writing our store (rulebooks,
// saved campaigns, verdicts, precedents). This backend only connects the agents
// and OBSERVES: it never creates rooms. The dashboard is fed by the SharedBoard
// (structured) plus the room's plain-English chatter (timeline).

import { RealBandTransport } from '../band/real';
import type { ActivityCallback, AgentConnection, BandTransport, ConnectOptions, IntakeControl } from '../band/types';
import type { BoardActivity } from '../band/types';
import { makeCoordinator } from '../agents/coordinator';
import { makeRegionReviewer } from '../agents/region-reviewer';
import { makeBrandReviewer } from '../agents/brand-reviewer';
import { makeRemediation } from '../agents/remediation';
import { makeReconcile, type Precedent } from '../agents/reconcile';
import { buildCrossFrameworkAdapter, CROSS_FRAMEWORK_BRAND_PROMPT } from '../band/cross-framework';
import type { BrandDna, ContentAsset, Rulebook } from '../domain/types';
import type { StartReviewOptions } from './shared';
import type { NewArtifact } from '../domain/artifact';
import { translateActivity, type BoardEvent } from './events';
import { SharedBoard } from './shared';
import type { BoardModels } from './session';

const COORDINATOR_HANDLE = '@pablomanjarres/coordinator';
const RECONCILE_HANDLE = '@pablomanjarres/reconcile';
const REMEDIATION_HANDLE = '@pablomanjarres/remediation';
const INTAKE_HANDLE = '@pablomanjarres/intake';

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
  /**
   * Transport factory (test seam). The product omits this and BandBoard builds a
   * RealBandTransport. A test supplies a factory returning a FakeBandTransport
   * wired to the given activity sink, so the band flow runs in-process with no
   * band.ai credentials. The factory receives BandBoard's own activity observer,
   * resolving the board<->transport construction order.
   */
  transport?: (onActivity: ActivityCallback) => BandBoardTransport;
  /**
   * IntakeControl factory (test seam). The product omits this and BandBoard
   * connects a real intake agent (transport.connectIntake). A test supplies a
   * FakeBandTransport-backed control so the campaign band flow posts materials
   * in-process with no band.ai credentials.
   */
  makeIntakeControl?: () => Promise<IntakeControl> | IntakeControl;
}

interface RoomBinding {
  onEvent: (event: BoardEvent) => void;
}

/** The per-material context a campaign run registers so the coordinator resolves the room's material. */
export interface BandMaterialContext {
  asset: ContentAsset;
  startOptions: StartReviewOptions;
}

/**
 * The transport surface BandBoard drives. The real product uses
 * RealBandTransport; the proof test injects a FakeBandTransport (which implements
 * connectAgent and the onActivity hook). connectIntake/connectFrameworkAgent are
 * optional so the fake (which has neither) still satisfies it; the campaign band
 * flow gets its IntakeControl injected instead.
 */
export interface BandBoardTransport extends BandTransport {
  connectAgent(opts: ConnectOptions): Promise<AgentConnection>;
  connectIntake?(opts?: { envPrefix?: string; name?: string }): Promise<IntakeControl>;
  connectFrameworkAgent?(opts: {
    name: string;
    adapter: unknown;
    envPrefix?: string;
    apiKey?: string;
    agentId?: string;
  }): Promise<AgentConnection>;
}

export class BandBoard {
  private readonly transport: BandBoardTransport;
  private readonly board: SharedBoard;
  private started = false;
  private readonly rooms = new Map<string, RoomBinding>();
  // Campaign band flow: per-material rooms pre-register a TAGGED event sink (so
  // events are stamped with campaignId/ad/material) and the material context the
  // coordinator resolves for that room. Keyed by band.ai room id.
  private readonly materialRooms = new Map<string, BandMaterialContext>();
  // Whether a transport was injected (test seam): when true, agent ids fall back to
  // stable handles instead of requiring PREFIX_AGENT_ID env vars (the product path).
  private readonly injected: boolean;
  // The connected coordinator's mention ref + the reviewer agent ids, captured at
  // start(), so the campaign intake can @mention the coordinator and add the
  // reviewers into each per-material room.
  private coordinatorRef: { id: string; handle: string } = { id: '', handle: COORDINATOR_HANDLE };
  private reconcileRef: { id: string; handle: string } = { id: '', handle: RECONCILE_HANDLE };
  private reviewerIds: string[] = [];

  constructor(private readonly opts: BandBoardOptions) {
    // The product builds a RealBandTransport with our activity observer; a test
    // injects a transport (FakeBandTransport) so the band campaign flow runs with
    // no band.ai credentials. Either way we wire the same onActivity sink.
    this.injected = Boolean(opts.transport);
    this.transport = opts.transport
      ? opts.transport((a) => this.dispatch(a))
      : (new RealBandTransport({ onActivity: (a) => this.dispatch(a) }) as BandBoardTransport);
    this.board = new SharedBoard((roomId, event) => this.routeEvent(roomId, event));
  }

  /**
   * Resolve an agent id: the product reads PREFIX_AGENT_ID from the env (band.ai
   * identities); a test (injected transport) uses the stable fallback so no env is
   * needed. The fallback also doubles as the fake transport's agent id.
   */
  private agentId(envKey: string, fallback: string): string {
    if (this.injected) return process.env[envKey] ?? fallback;
    return requireEnv(envKey);
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
      agentId: this.agentId('COORDINATOR_AGENT_ID', 'coord'),
      name: 'Coordinator',
      handle: COORDINATOR_HANDLE,
      envPrefix: 'COORDINATOR',
      onMessage: makeCoordinator({
        board,
        intakeAgentHandle: INTAKE_HANDLE,
        remediationHandle: REMEDIATION_HANDLE,
        reconcileHandle: RECONCILE_HANDLE,
        // Recruit only the reviewers the asset's markets target (Brand always joins).
        regionHandles: {
          US: '@pablomanjarres/us-reviewer',
          EU: '@pablomanjarres/eu-reviewer',
          LATAM: '@pablomanjarres/latam-reviewer',
        },
        ...(this.opts.lookupCampaign ? { lookupCampaign: this.opts.lookupCampaign } : {}),
        // Campaign band flow: resolve the material posted into a given room (with
        // its dossier + campaign/ad/material ids) so one connected coordinator
        // serves every material room. A miss is the unchanged single-asset path.
        lookupMaterial: (roomId) => this.materialRooms.get(roomId),
      }),
    });
    await this.transport.connectAgent({
      agentId: this.agentId('US_AGENT_ID', 'us'),
      name: 'US Reviewer',
      handle: '@pablomanjarres/us-reviewer',
      envPrefix: 'US',
      onMessage: makeRegionReviewer({ board, region: 'US', reviewerName: 'US Reviewer', rulebook: rulebooks.us, brand, model: models.us, reportToHandle: RECONCILE_HANDLE, getRulebook: rulebookFor('us'), precedents: this.opts.getPrecedents }),
    });
    await this.transport.connectAgent({
      agentId: this.agentId('EU_AGENT_ID', 'eu'),
      name: 'EU Reviewer',
      handle: '@pablomanjarres/eu-reviewer',
      envPrefix: 'EU',
      onMessage: makeRegionReviewer({ board, region: 'EU', reviewerName: 'EU Reviewer', rulebook: rulebooks.eu, brand, model: models.eu, reportToHandle: RECONCILE_HANDLE, getRulebook: rulebookFor('eu'), precedents: this.opts.getPrecedents }),
    });
    await this.transport.connectAgent({
      agentId: this.agentId('LATAM_AGENT_ID', 'latam'),
      name: 'LATAM Reviewer',
      handle: '@pablomanjarres/latam-reviewer',
      envPrefix: 'LATAM',
      onMessage: makeRegionReviewer({ board, region: 'LATAM', reviewerName: 'LATAM Reviewer', rulebook: rulebooks.latam, brand, model: models.latam, reportToHandle: RECONCILE_HANDLE, getRulebook: rulebookFor('latam'), precedents: this.opts.getPrecedents }),
    });
    await this.transport.connectAgent({
      agentId: this.agentId('BRAND_AGENT_ID', 'brand'),
      name: 'Brand Reviewer',
      handle: '@pablomanjarres/brand-reviewer',
      envPrefix: 'BRAND',
      onMessage: makeBrandReviewer({ board, brand, model: models.brand, reportToHandle: RECONCILE_HANDLE }),
    });
    await this.transport.connectAgent({
      agentId: this.agentId('REMEDIATION_AGENT_ID', 'rem'),
      name: 'Remediation',
      handle: REMEDIATION_HANDLE,
      envPrefix: 'REMEDIATION',
      onMessage: makeRemediation({ board, brand, copyModel: models.remediationCopy, imageModel: models.image, reportToHandle: COORDINATOR_HANDLE, ...(this.opts.hostImage ? { hostImage: this.opts.hostImage } : {}), ...(this.opts.publishArtifact ? { publishArtifact: this.opts.publishArtifact } : {}) }),
    });
    await this.transport.connectAgent({
      agentId: this.agentId('RECONCILE_AGENT_ID', 'rec'),
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
        // Live band.ai flow: give every blocking region one regeneration attempt
        // before escalating, so the rebranded visual shows in the chat. Reviewers
        // re-file here (unlike the key-free stubs), so the re-review completes.
        autoRemediateOnEscalate: true,
        // The band.ai SDK posts only as an agent, so a human ruling on an
        // escalation (the campaign-review decision endpoint, or the single-asset
        // decision) is relayed by the intake/proxy agent. Reconcile accepts it from
        // this handle and logs precedent.
        humanProxyHandle: INTAKE_HANDLE,
        ...(this.opts.humanHandle ? { humanHandle: this.opts.humanHandle } : {}),
        ...(this.opts.logPrecedent ? { logPrecedent: this.opts.logPrecedent } : {}),
        ...(this.opts.publishArtifact ? { publishArtifact: this.opts.publishArtifact } : {}),
      }),
    });

    // Capture the coordinator's mention ref and the reviewer agent ids so the
    // campaign intake can @mention the coordinator and add the reviewers into each
    // per-material room. The handles are fixed; the ids match what we connected.
    this.coordinatorRef = { id: this.agentId('COORDINATOR_AGENT_ID', 'coord'), handle: COORDINATOR_HANDLE };
    this.reconcileRef = { id: this.agentId('RECONCILE_AGENT_ID', 'rec'), handle: RECONCILE_HANDLE };
    this.reviewerIds = [
      this.agentId('US_AGENT_ID', 'us'),
      this.agentId('EU_AGENT_ID', 'eu'),
      this.agentId('LATAM_AGENT_ID', 'latam'),
      this.agentId('BRAND_AGENT_ID', 'brand'),
      this.agentId('RECONCILE_AGENT_ID', 'rec'),
      this.agentId('REMEDIATION_AGENT_ID', 'rem'),
    ];

    // Cross-framework advisor (opt-in via XFRAMEWORK_AGENT_ID + AIML_API_KEY): one
    // reviewer running on the SDK's OpenAI tool-calling framework instead of the
    // GenericAdapter, so the room visibly spans frameworks, not just models. It
    // coordinates via the room tools (narrates a thought, posts a brand-voice
    // finding, @mentions reconcile); it does not file a structured board verdict.
    if (process.env.XFRAMEWORK_AGENT_ID && process.env.AIML_API_KEY && this.transport.connectFrameworkAgent) {
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
      // A campaign run pre-registers a tagged sink for a material room via
      // observeRoom; honor it. Otherwise this is a single-asset review and we
      // auto-discover it (the unchanged band path).
      binding = { onEvent: this.opts.onReviewDiscovered(roomId) };
      this.rooms.set(roomId, binding);
    }
    binding.onEvent(event);
  }

  /**
   * Pre-register an event sink for a room (the campaign band flow). Every event
   * routed for this room id goes to the sink instead of auto-discovering a
   * single-asset review. The campaign session passes a sink that stamps each event
   * with campaignId/advertisementId/materialId, so the existing campaign-review SSE
   * lanes them per material. Idempotent per room id.
   */
  observeRoom(roomId: string, onEvent: (event: BoardEvent) => void): void {
    this.rooms.set(roomId, { onEvent });
  }

  /** Forget a room's sink + material context once its material has reached a terminal state. */
  releaseRoom(roomId: string): void {
    this.rooms.delete(roomId);
    this.materialRooms.delete(roomId);
  }

  /**
   * Register the material a room is reviewing so the connected coordinator
   * resolves it (asset + dossier + campaign/ad/material ids) for that room id.
   * Must be set BEFORE the intake posts the material into the room.
   */
  registerMaterialRoom(roomId: string, ctx: BandMaterialContext): void {
    this.materialRooms.set(roomId, ctx);
  }

  /**
   * The IntakeControl that drives band.ai rooms (create, add participants, post).
   * The product connects a real intake agent (connectIntake). A test injects its
   * own IntakeControl (a FakeBandTransport-backed one) via the option. Throws if
   * neither is available, since a campaign cannot be posted without it.
   */
  async intakeControl(): Promise<IntakeControl> {
    if (this.opts.makeIntakeControl) return this.opts.makeIntakeControl();
    if (this.transport.connectIntake) return this.transport.connectIntake({ envPrefix: 'INTAKE', name: 'Intake' });
    throw new Error('No intake control available (set BandBoardOptions.makeIntakeControl or use a transport with connectIntake)');
  }

  /** The connected coordinator's mention ref, so the campaign intake can @mention it. */
  coordinatorMention(): { id: string; handle: string } {
    return this.coordinatorRef;
  }

  /** The connected reconcile's mention ref, so a human ruling can be relayed to it. */
  reconcileMention(): { id: string; handle: string } {
    return this.reconcileRef;
  }

  /** The reviewer/reconcile/remediation agent ids, so the campaign intake can add them to each room. */
  reviewerAgentIds(): string[] {
    return [...this.reviewerIds];
  }
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required for band mode (BOARD_MODE=band)`);
  return value;
}
