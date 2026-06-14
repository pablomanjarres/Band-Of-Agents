// band.ai room mode: band.ai is the integration layer. The campaign portal
// (server) calls createReview(); the Intake agent creates a real band.ai room,
// adds the reviewer agents, and posts the campaign. The agents then collaborate
// in that room (recruit, review, reconcile, remediate, escalate) entirely
// through band.ai. Every outbound message/event is observed via the transport's
// activity hook, translated, and streamed to the UI. The app never calls a
// reviewer; it drops the campaign into band.ai and watches.

import { RealBandTransport } from '../band/real';
import type { BoardActivity, IntakeControl } from '../band/types';
import { makeCoordinator } from '../agents/coordinator';
import { makeRegionReviewer } from '../agents/region-reviewer';
import { makeBrandReviewer } from '../agents/brand-reviewer';
import { makeRemediation } from '../agents/remediation';
import { makeReconcile, type Precedent } from '../agents/reconcile';
import type { BrandDna, ContentAsset, Rulebook } from '../domain/types';
import { translateActivity, type BoardEvent } from './events';
import type { BoardModels } from './session';

const INTAKE_HANDLE = '@pablomanjarres/intake';
const COORDINATOR_HANDLE = '@pablomanjarres/coordinator';
const RECONCILE_HANDLE = '@pablomanjarres/reconcile';
const REMEDIATION_HANDLE = '@pablomanjarres/remediation';

export interface BandBoardOptions {
  brand: BrandDna;
  rulebooks: { us: Rulebook; eu: Rulebook; latam: Rulebook };
  models: BoardModels;
  humanHandle?: string;
  onPrecedent?: (precedent: Precedent) => void;
  /** Host generated images (base64 -> short URL) so band.ai messages stay small. */
  hostImage?: (url: string) => string;
  /** Delay after adding agents before posting, so they subscribe to the new room. */
  joinDelayMs?: number;
}

interface RoomBinding {
  onEvent: (event: BoardEvent) => void;
  escalated: boolean;
  decided: boolean;
}

interface AgentIds {
  coord: string;
  us: string;
  eu: string;
  latam: string;
  brand: string;
  rem: string;
  rec: string;
}

export class BandBoard {
  private transport: RealBandTransport;
  private intake: IntakeControl | undefined;
  private ids: AgentIds | undefined;
  private started = false;
  private readonly rooms = new Map<string, RoomBinding>();

  constructor(private readonly opts: BandBoardOptions) {
    this.transport = new RealBandTransport({ onActivity: (a) => this.dispatch(a) });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    const ids: AgentIds = {
      coord: requireEnv('COORDINATOR_AGENT_ID'),
      us: requireEnv('US_AGENT_ID'),
      eu: requireEnv('EU_AGENT_ID'),
      latam: requireEnv('LATAM_AGENT_ID'),
      brand: requireEnv('BRAND_AGENT_ID'),
      rem: requireEnv('REMEDIATION_AGENT_ID'),
      rec: requireEnv('RECONCILE_AGENT_ID'),
    };
    this.ids = ids;

    const { brand, rulebooks, models } = this.opts;

    await this.transport.connectAgent({
      agentId: ids.coord,
      name: 'Coordinator',
      handle: COORDINATOR_HANDLE,
      envPrefix: 'COORDINATOR',
      onMessage: makeCoordinator({ intakeAgentHandle: INTAKE_HANDLE, remediationHandle: REMEDIATION_HANDLE }),
    });
    await this.transport.connectAgent({
      agentId: ids.us,
      name: 'US Reviewer',
      handle: '@pablomanjarres/us-reviewer',
      envPrefix: 'US',
      onMessage: makeRegionReviewer({ region: 'US', reviewerName: 'US Reviewer', rulebook: rulebooks.us, brand, model: models.us, reportToHandle: RECONCILE_HANDLE, ignoreFromHandle: INTAKE_HANDLE }),
    });
    await this.transport.connectAgent({
      agentId: ids.eu,
      name: 'EU Reviewer',
      handle: '@pablomanjarres/eu-reviewer',
      envPrefix: 'EU',
      onMessage: makeRegionReviewer({ region: 'EU', reviewerName: 'EU Reviewer', rulebook: rulebooks.eu, brand, model: models.eu, reportToHandle: RECONCILE_HANDLE, ignoreFromHandle: INTAKE_HANDLE }),
    });
    await this.transport.connectAgent({
      agentId: ids.latam,
      name: 'LATAM Reviewer',
      handle: '@pablomanjarres/latam-reviewer',
      envPrefix: 'LATAM',
      onMessage: makeRegionReviewer({ region: 'LATAM', reviewerName: 'LATAM Reviewer', rulebook: rulebooks.latam, brand, model: models.latam, reportToHandle: RECONCILE_HANDLE, ignoreFromHandle: INTAKE_HANDLE }),
    });
    await this.transport.connectAgent({
      agentId: ids.brand,
      name: 'Brand Reviewer',
      handle: '@pablomanjarres/brand-reviewer',
      envPrefix: 'BRAND',
      onMessage: makeBrandReviewer({ brand, model: models.brand, reportToHandle: RECONCILE_HANDLE, ignoreFromHandle: INTAKE_HANDLE }),
    });
    await this.transport.connectAgent({
      agentId: ids.rem,
      name: 'Remediation',
      handle: REMEDIATION_HANDLE,
      envPrefix: 'REMEDIATION',
      onMessage: makeRemediation({ brand, copyModel: models.remediationCopy, imageModel: models.image, reportToHandle: COORDINATOR_HANDLE, ...(this.opts.hostImage ? { hostImage: this.opts.hostImage } : {}) }),
    });
    await this.transport.connectAgent({
      agentId: ids.rec,
      name: 'Reconcile',
      handle: RECONCILE_HANDLE,
      envPrefix: 'RECONCILE',
      onMessage: makeReconcile({
        expectedRegions: ['US', 'EU', 'LATAM', 'BRAND'],
        coordinatorHandle: COORDINATOR_HANDLE,
        remediationHandle: REMEDIATION_HANDLE,
        humanProxyHandle: INTAKE_HANDLE,
        ...(this.opts.humanHandle ? { humanHandle: this.opts.humanHandle } : {}),
        ...(this.opts.onPrecedent ? { logPrecedent: this.opts.onPrecedent } : {}),
      }),
    });

    this.intake = await this.transport.connectIntake({ envPrefix: 'INTAKE', name: 'Intake' });
  }

  /** Create a band.ai room for one campaign, add the agents, and post it. Returns the room id. */
  async createReview(asset: ContentAsset, onEvent: (event: BoardEvent) => void): Promise<string> {
    if (!this.intake || !this.ids) throw new Error('BandBoard not started');
    const ids = this.ids;
    const roomId = await this.intake.createRoom();
    this.rooms.set(roomId, { onEvent, escalated: false, decided: false });

    for (const id of [ids.coord, ids.us, ids.eu, ids.latam, ids.brand, ids.rem, ids.rec]) {
      await this.intake.addParticipant(roomId, id);
    }
    // Give the freshly added agents a moment to subscribe to the new room.
    await new Promise((resolve) => setTimeout(resolve, this.opts.joinDelayMs ?? 1500));

    onEvent({ type: 'intake', seq: 0, fromName: 'You', asset });
    onEvent({ type: 'status', seq: 0, fromName: 'system', status: 'running' });
    await this.intake.postMessage(roomId, JSON.stringify(asset), [
      { id: ids.coord, handle: COORDINATOR_HANDLE, name: 'Coordinator' },
    ]);
    return roomId;
  }

  /** Relay a human ruling on an escalation into the room (mentions Reconcile). */
  async submitDecision(roomId: string, text: string): Promise<void> {
    if (!this.intake || !this.ids) throw new Error('BandBoard not started');
    await this.intake.postMessage(roomId, text, [{ id: this.ids.rec, handle: RECONCILE_HANDLE, name: 'Reconcile' }]);
  }

  private dispatch(activity: BoardActivity): void {
    const binding = this.rooms.get(activity.roomId);
    if (!binding) return;
    const event = translateActivity(activity);
    if (!event) return;

    if (event.type === 'escalation') binding.escalated = true;
    if (event.type === 'decision') binding.decided = true;
    binding.onEvent(event);

    // Derive terminal status from the verdict (band.ai has no local drain):
    // an adapt round is not terminal (remediation + re-review follow), an
    // escalate awaits the human, all-publish is complete.
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
