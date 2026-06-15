import type {
  BoardEvent,
  BoardStatus,
  Campaign,
  CampaignRollup,
  ContentAsset,
  Finding,
  Material,
  VerdictDecision,
} from './types';

// The four regions are always shown, in this fixed order.
export const REGION_ORDER = ['US', 'EU', 'LATAM', 'BRAND'] as const;
export type RegionName = (typeof REGION_ORDER)[number];

export type RegionStatus = 'reviewing' | VerdictDecision;

export interface RegionState {
  region: string;
  status: RegionStatus;
  reviewerName?: string;
  findings: Finding[];
  blocking: number;
  rationale?: string;
}

export interface Remediation {
  region: string;
  copy: string;
  imageUrl?: string;
  markets: string[];
}

/**
 * The live multimodal-perception snapshot for a material (the "analyzing" panel):
 * the current keyframe being read, progress, the stage, and the transcript as it
 * returns. Updated by every 'perceiving' tick; `done` flips when the pass settles.
 */
export interface PerceivingState {
  frameUrl?: string;
  index: number;
  total: number;
  stage: 'vision' | 'stt' | 'done';
  transcript?: string;
  done: boolean;
}

export interface BoardState {
  asset?: ContentAsset;
  regions: Record<string, RegionState>;
  conflict: boolean;
  remediation?: Remediation;
  escalationText?: string;
  decisionText?: string;
  status: BoardStatus;
  events: BoardEvent[];
  /** Live perception panel state, present once the perception pre-pass starts. */
  perceiving?: PerceivingState;
}

function freshRegion(region: string): RegionState {
  return { region, status: 'reviewing', findings: [], blocking: 0 };
}

export function initialBoardState(): BoardState {
  const regions: Record<string, RegionState> = {};
  for (const region of REGION_ORDER) {
    regions[region] = freshRegion(region);
  }
  return {
    regions,
    conflict: false,
    status: 'running',
    events: [],
  };
}

/**
 * Apply a single BoardEvent to the board state, returning a new state object.
 * Events are appended to the timeline in arrival order regardless of type.
 */
export function applyEvent(prev: BoardState, event: BoardEvent): BoardState {
  const next: BoardState = {
    ...prev,
    regions: { ...prev.regions },
    events: [...prev.events, event],
  };

  switch (event.type) {
    case 'intake': {
      next.asset = event.asset;
      break;
    }
    case 'review': {
      const existing = next.regions[event.region] ?? freshRegion(event.region);
      next.regions[event.region] = {
        ...existing,
        reviewerName: event.reviewerName,
        findings: event.findings,
        blocking: event.blocking,
        // Stay in "reviewing" until a verdict arrives.
        status: existing.status === 'reviewing' ? 'reviewing' : existing.status,
      };
      break;
    }
    case 'verdict': {
      for (const verdict of event.verdicts) {
        const existing = next.regions[verdict.region] ?? freshRegion(verdict.region);
        next.regions[verdict.region] = {
          ...existing,
          status: verdict.decision,
          rationale: verdict.rationale,
        };
      }
      next.conflict = event.conflict;
      break;
    }
    case 'revised': {
      next.remediation = {
        region: event.region,
        copy: event.copy,
        imageUrl: event.imageUrl,
        markets: event.markets,
      };
      break;
    }
    case 'escalation': {
      next.escalationText = event.text;
      break;
    }
    case 'decision': {
      next.decisionText = event.text;
      break;
    }
    case 'status': {
      next.status = event.status;
      break;
    }
    case 'perceiving': {
      const priorTranscript = next.perceiving?.transcript;
      next.perceiving = {
        ...(event.frameUrl !== undefined ? { frameUrl: event.frameUrl } : next.perceiving?.frameUrl !== undefined ? { frameUrl: next.perceiving.frameUrl } : {}),
        index: event.index,
        total: event.total,
        stage: event.stage,
        // Keep the transcript once it has arrived even if a later tick omits it.
        ...(event.transcript !== undefined ? { transcript: event.transcript } : priorTranscript !== undefined ? { transcript: priorTranscript } : {}),
        done: event.stage === 'done',
      };
      break;
    }
    case 'recruited':
    case 'progress':
    case 'log': {
      // Timeline-only events; already appended above.
      break;
    }
    default: {
      // Exhaustiveness guard: every event type must be handled.
      const _never: never = event;
      return _never;
    }
  }

  return next;
}

export function buildBoardState(events: BoardEvent[]): BoardState {
  return events.reduce(applyEvent, initialBoardState());
}

/** Regions in canonical display order (always the four core regions). */
export function orderedRegions(state: BoardState): RegionState[] {
  return REGION_ORDER.map((name) => state.regions[name] ?? freshRegion(name));
}


// --- Campaign board state -------------------------------------------------
// A campaign review streams ONE combined event feed in which every event carries
// a materialId. We lane each material into its own full BoardState (reusing the
// single-asset reducer above), so drilling into a material reuses PipelineDiagram
// unchanged. The aggregate verdict is the observational worst-case per region
// across every material (block/escalate beats adapt beats publish): it mirrors
// the backend rollup and gates nothing (the one rule).

export interface MaterialLane {
  material: Material;
  board: BoardState;
}

export interface CampaignBoardState {
  campaign?: Campaign;
  // Per-material lanes, keyed by materialId, in declared order via `order`.
  lanes: Record<string, MaterialLane>;
  order: string[];
  // The whole-campaign status (running until every material is terminal).
  status: BoardStatus;
  // The latest server-computed rollup, when present (authoritative for the badge).
  rollup?: CampaignRollup;
  // Combined raw event log, for a campaign-wide timeline if needed.
  events: BoardEvent[];
}

function freshLane(material: Material): MaterialLane {
  // A Material is structurally a ContentAsset plus campaign fields, so it seeds the
  // lane board's asset header directly (the lane reuses the single-asset reducer).
  const board = initialBoardState();
  return { material, board: { ...board, asset: material } };
}

export function initialCampaignState(campaign?: Campaign): CampaignBoardState {
  const lanes: Record<string, MaterialLane> = {};
  const order: string[] = [];
  if (campaign) {
    for (const material of campaign.materials) {
      lanes[material.id] = freshLane(material);
      order.push(material.id);
    }
  }
  return {
    ...(campaign ? { campaign } : {}),
    lanes,
    order,
    status: 'running',
    events: [],
  };
}

// A campaign-level terminal status carries NO materialId (the backend emits one
// final {type:'status'} with no ids once every material rests). A status event
// WITH a materialId belongs to that material's lane and never ends the campaign.
function isCampaignLevelStatus(event: BoardEvent): boolean {
  return event.type === 'status' && event.materialId === undefined;
}

/**
 * Apply one event from the combined campaign stream. Events tagged with a
 * materialId are folded into that material's lane via the single-asset reducer;
 * a campaign-level status (no materialId) sets the whole-campaign status.
 */
export function applyCampaignEvent(
  prev: CampaignBoardState,
  event: BoardEvent,
): CampaignBoardState {
  const next: CampaignBoardState = {
    ...prev,
    lanes: { ...prev.lanes },
    order: [...prev.order],
    events: [...prev.events, event],
  };

  if (isCampaignLevelStatus(event) && event.type === 'status') {
    next.status = event.status;
    return next;
  }

  const materialId = event.materialId;
  if (!materialId) {
    // No lane to route to (e.g. a campaign-level log line); keep it in events only.
    return next;
  }

  const existing = next.lanes[materialId];
  if (existing) {
    next.lanes[materialId] = { ...existing, board: applyEvent(existing.board, event) };
  } else {
    // A material we did not know up front (e.g. resumed from a stored review with
    // no campaign loaded yet): synthesize a lane from the intake asset when we can.
    const synthetic: Material =
      event.type === 'intake'
        ? { ...event.asset, kind: 'post' }
        : { id: materialId, name: materialId, kind: 'post', channel: '', markets: [], copy: '', claim: '' };
    const lane = freshLane(synthetic);
    next.lanes[materialId] = { ...lane, board: applyEvent(lane.board, event) };
    next.order.push(materialId);
  }
  return next;
}

export function buildCampaignState(
  events: BoardEvent[],
  campaign?: Campaign,
): CampaignBoardState {
  return events.reduce(applyCampaignEvent, initialCampaignState(campaign));
}

// publish is clear; adapt is worse; escalate is worst. Worst-case per region
// takes the highest rank seen across all materials (matches src/board/campaign.ts).
const DECISION_RANK: Record<VerdictDecision, number> = {
  publish: 0,
  adapt: 1,
  escalate: 2,
};

function worseDecision(a: VerdictDecision, b: VerdictDecision): VerdictDecision {
  return DECISION_RANK[a] >= DECISION_RANK[b] ? a : b;
}

/**
 * The aggregate campaign verdict, derived from the per-material lane states.
 * Folds every region verdict across every material to the worst case per region,
 * then collapses to a single campaign decision (the worst region). Returns
 * undefined until at least one material has produced a verdict.
 */
export function deriveAggregateVerdict(
  state: CampaignBoardState,
): VerdictDecision | undefined {
  // Prefer the authoritative server rollup when present.
  const fromRollup = state.rollup?.worstCaseByRegion ?? [];
  const decisions: VerdictDecision[] = [];
  if (fromRollup.length > 0) {
    for (const r of fromRollup) decisions.push(r.decision);
  } else {
    for (const id of state.order) {
      const lane = state.lanes[id];
      if (!lane) continue;
      for (const region of REGION_ORDER) {
        const rs = lane.board.regions[region];
        if (rs && rs.status !== 'reviewing') decisions.push(rs.status);
      }
    }
  }
  if (decisions.length === 0) return undefined;
  return decisions.reduce((acc, d) => worseDecision(acc, d));
}

/** One cell of the material x region matrix, derived from lane states. */
export interface MatrixCell {
  status: RegionStatus;
  blocking: number;
  findings: number;
  rationale?: string;
}

/** A row of the matrix: a material plus its per-region cells (REGION_ORDER). */
export interface MatrixRow {
  materialId: string;
  material: Material;
  cells: Record<string, MatrixCell>;
}

/**
 * Build the material x region matrix from lane states (rows = materials, columns
 * = the four regions). Each cell carries the region's current status plus its
 * finding counts so the UI shows verdict + finding count per cell.
 */
export function buildMatrix(state: CampaignBoardState): MatrixRow[] {
  return state.order
    .map((id) => state.lanes[id])
    .filter((lane): lane is MaterialLane => Boolean(lane))
    .map((lane) => {
      const cells: Record<string, MatrixCell> = {};
      for (const region of REGION_ORDER) {
        const rs = lane.board.regions[region];
        cells[region] = {
          status: rs?.status ?? 'reviewing',
          blocking: rs?.blocking ?? 0,
          findings: rs?.findings.length ?? 0,
          ...(rs?.rationale ? { rationale: rs.rationale } : {}),
        };
      }
      return { materialId: lane.material.id, material: lane.material, cells };
    });
}

// --- Perception panel selector -------------------------------------------
// The live "analyzing" panel reads one snapshot per material that is currently
// being perceived. A lane is "perceiving" once its pre-pass has emitted at least
// one tick and has not settled (done) yet; when the pass finishes (or the
// material reaches a verdict) it drops out and the matrix carries the result.
// If perception is OFF entirely, no lane ever has a snapshot, so the list is
// empty and the panel simply does not render.

/** A material actively under the perception pre-pass, with the data the panel shows. */
export interface PerceivingLane {
  materialId: string;
  material: Material;
  perceiving: PerceivingState;
  /**
   * The transcript to surface. The stream does not carry transcript text (only
   * frame ticks), so prefer the material's known perception transcript (seeded or
   * resolved); fall back to anything a tick happened to include.
   */
  transcript?: string;
}

function laneHasVerdict(lane: MaterialLane): boolean {
  return REGION_ORDER.some((region) => {
    const rs = lane.board.regions[region];
    return rs ? rs.status !== 'reviewing' : false;
  });
}

/**
 * The materials whose perception pre-pass is live right now, in declared order.
 * A lane qualifies while it has a perceiving snapshot that has not settled and the
 * material has not yet produced any verdict (so the panel yields to the matrix the
 * moment reviewers land a decision). Returns [] when perception is off.
 */
export function activePerceivingLanes(state: CampaignBoardState): PerceivingLane[] {
  const out: PerceivingLane[] = [];
  for (const id of state.order) {
    const lane = state.lanes[id];
    if (!lane) continue;
    const perceiving = lane.board.perceiving;
    if (!perceiving) continue;
    if (perceiving.done && laneHasVerdict(lane)) continue;
    const transcript = lane.material.perception?.transcript ?? perceiving.transcript;
    out.push({
      materialId: lane.material.id,
      material: lane.material,
      perceiving,
      ...(transcript !== undefined ? { transcript } : {}),
    });
  }
  return out;
}
