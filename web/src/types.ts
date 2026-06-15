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
  /** Which material this verdict covers, when the review is part of a campaign. */
  materialId?: string;
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

/**
 * Campaign coordinates carried on every event when the review is part of a
 * campaign. Optional so single-asset reviews (no campaign) and old stored events
 * keep the exact same shape: the ids are simply absent. Mirrors the backend
 * BoardEventCampaignRef in src/board/events.ts.
 */
export interface BoardEventCampaignRef {
  campaignId?: string;
  materialId?: string;
}

/**
 * A live keyframe-analysis tick from the multimodal perception pass (Rung C).
 * Defined now for the perception SSE channel; it is not yet a BoardEvent union
 * member (the live-board reducers stay exhaustive until Rung C adds its UI).
 */
export interface PerceivingEvent extends BoardEventCampaignRef {
  type: 'perceiving';
  seq: number;
  fromName: string;
  frameUrl?: string;
  index: number;
  total: number;
  stage: 'vision' | 'stt' | 'done';
  transcript?: string;
}

export type BoardEvent = (
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
  | { type: 'status'; seq: number; fromName: string; status: BoardStatus }
) &
  BoardEventCampaignRef;

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


// Campaigns ----------------------------------------------------------------
// A Campaign groups many Materials (videos, posts, images, banners) under one
// product, sharing a single cascading dossier. Mirrors src/domain/types.ts. A
// Material is structurally a ContentAsset plus a discriminating kind, optional
// video, optional perception artifacts, and one level of attachments.

export type MaterialKind = 'video' | 'post' | 'image' | 'banner';

/** Reference source uploaded into the dossier (grounds the reviewers). */
export interface DossierSource {
  name: string;
  kind: 'md' | 'json' | 'text';
  content: string;
}

/** Shared source-of-truth that cascades into every material's review. */
export interface CampaignDossier {
  approvedClaims: string[];
  substantiation: string;
  approvedInfo: string;
  sources: DossierSource[];
}

/** Perception artifacts from the multimodal pre-pass (Rung C); all text + frames. */
export interface MaterialPerception {
  transcript?: string;
  onScreenText?: string;
  visualDescription?: string;
  detectedClaims?: string[];
  frames: string[];
}

/** A single marketing material in a campaign (one level of attachments only). */
export interface Material extends ContentAsset {
  kind: MaterialKind;
  videoUrl?: string;
  perception?: MaterialPerception;
  attachments?: Material[];
}

/** A product launch: many materials sharing one cascading dossier. */
export interface Campaign {
  id: string;
  name: string;
  markets: string[];
  dossier: CampaignDossier;
  materials: Material[];
}

/** Card-level summary returned by GET /api/campaigns. */
export interface CampaignSummary {
  id: string;
  name: string;
  markets: string[];
  materialCount: number;
}

export interface CampaignListResponse {
  campaigns: CampaignSummary[];
}

export interface CampaignResponse {
  campaign: Campaign;
}

export interface MaterialResponse {
  campaign: Campaign;
  material: Material;
}

// Campaign review (observational rollup over per-material verdicts) -----------
// The rollup gates nothing (the one rule): it is a derived worst-case-per-region
// badge plus the full material x region matrix. Mirrors src/board/campaign.ts.

export interface RollupRegion {
  region: string;
  decision: VerdictDecision;
}

export interface RollupCell {
  materialId: string;
  region: string;
  decision: VerdictDecision;
  rationale: string;
}

export interface CampaignRollup {
  campaignId: string;
  worstCaseByRegion: RollupRegion[];
  matrix: RollupCell[];
  perMaterial: Array<{ materialId: string; verdicts: RegionVerdict[] }>;
}

/** Response for GET /api/campaign-reviews/:id. */
export interface CampaignReviewResponse {
  id: string;
  status: BoardStatus;
  campaign: Campaign;
  rollup: CampaignRollup | null;
  events: BoardEvent[];
}

/** Response for POST /api/reviews when a campaign is submitted. */
export interface CreateCampaignReviewResponse {
  id: string;
  kind: 'campaign';
  materials: string[];
}
