export type BoardStatus = 'running' | 'awaiting-decision' | 'complete' | 'error';

export type Severity = 'block' | 'warn' | 'info';

export interface Finding {
  category: string;
  severity: Severity;
  claim: string;
  rationale: string;
  ruleId?: string;
  requiredDisclosure?: string | null;
  confidence?: number;
}

export type VerdictDecision = 'publish' | 'adapt' | 'escalate';

export interface RegionVerdict {
  region: string;
  decision: VerdictDecision;
  rationale: string;
}

export interface ContentAsset {
  id: string;
  name?: string;
  channel: string;
  markets: string[];
  copy: string;
  claim: string;
  imagePrompt?: string;
  imageUrl?: string;
  substantiation?: string;
}

export type BoardEvent =
  | { type: 'intake'; seq: number; fromName: string; asset: ContentAsset }
  | { type: 'recruited'; seq: number; fromName: string; text: string }
  | {
      type: 'review';
      seq: number;
      fromName: string;
      region: string;
      reviewerName: string;
      findings: Finding[];
      blocking: number;
    }
  | { type: 'progress'; seq: number; fromName: string; text: string }
  | { type: 'verdict'; seq: number; fromName: string; verdicts: RegionVerdict[]; conflict: boolean }
  | {
      type: 'revised';
      seq: number;
      fromName: string;
      region: string;
      copy: string;
      imageUrl?: string;
      markets: string[];
    }
  | { type: 'escalation'; seq: number; fromName: string; text: string }
  | { type: 'decision'; seq: number; fromName: string; text: string }
  | { type: 'log'; seq: number; fromName: string; messageType: string; text: string }
  | { type: 'status'; seq: number; fromName: string; status: BoardStatus };

// Request / response shapes for the REST endpoints.
export interface CreateReviewRequest {
  copy: string;
  claim: string;
  channel: string;
  markets: string[];
  imagePrompt?: string;
  substantiation?: string;
}

export interface CreateReviewResponse {
  id: string;
}

export interface DecisionResponse {
  ok: true;
}

export interface ReviewSummary {
  id: string;
  createdAt: number;
  assetId: string;
  copy: string;
  markets: string[];
  status: BoardStatus;
  conflict?: boolean;
}

export interface ReviewListResponse {
  reviews: ReviewSummary[];
}

export interface ReviewReplayResponse {
  id: string;
  events: BoardEvent[];
  status: BoardStatus;
}

// Rulebooks ----------------------------------------------------------------
export interface Rule {
  id: string;
  region: string;
  category: string;
  severity: Severity;
  check: string;
  requiredDisclosure: string | null;
  sourceUrl?: string;
}

export interface Rulebook {
  region: string;
  label: string;
  notLegalAdvice: true;
  rules: Rule[];
}

export interface RulebookListResponse {
  rulebooks: Rulebook[];
}

export interface RulebookResponse {
  rulebook: Rulebook;
}

// Asset library ------------------------------------------------------------
export interface AssetListResponse {
  assets: ContentAsset[];
}

export interface AssetResponse {
  asset: ContentAsset;
}

// Precedent log ------------------------------------------------------------
export interface Precedent {
  roomId: string;
  regions: string[];
  decision: string;
}

export interface PrecedentListResponse {
  precedents: Precedent[];
}
