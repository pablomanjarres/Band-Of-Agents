import type {
  BoardEvent,
  BoardStatus,
  ContentAsset,
  Finding,
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

// One pod's board-facing summary: whether it filed its consolidated finding and
// how many cross-pod conflicts it carried.
export interface PodState {
  filed: boolean;
  conflicts: number;
}

// The spine phase the board is in, derived from the events seen so far.
export type BoardPhase = 'intake' | 'deliberating' | 'reconciling' | 'deciding' | 'terminal';

export type TerminalDecision = 'published' | 'spiked' | 'escalated';

export interface BoardState {
  asset?: ContentAsset;
  regions: Record<string, RegionState>;
  conflict: boolean;
  remediation?: Remediation;
  escalationText?: string;
  decisionText?: string;
  status: BoardStatus;
  // 'claims' | 'regulatory' | 'brand' -> filed/conflicts, populated as pods report.
  pods: Record<string, PodState>;
  phase: BoardPhase;
  terminal?: TerminalDecision;
  events: BoardEvent[];
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
    pods: {},
    phase: 'intake',
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
    pods: { ...prev.pods },
    events: [...prev.events, event],
  };

  switch (event.type) {
    case 'intake': {
      next.asset = event.asset;
      next.phase = 'deliberating';
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
    case 'pod-finding': {
      // A pod filed its consolidated finding; the board moves to reconciling.
      next.pods[event.pod] = { filed: true, conflicts: event.conflicts };
      next.phase = 'reconciling';
      break;
    }
    case 'adjudication': {
      // The Risk Adjudicator is scoring the board.
      next.phase = 'deciding';
      break;
    }
    case 'terminal': {
      next.phase = 'terminal';
      next.terminal = event.decision;
      next.status = 'complete';
      break;
    }
    case 'recruited':
    case 'progress':
    case 'log':
    case 'workitem':
    case 'debate':
    case 'mediation': {
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
