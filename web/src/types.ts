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
  /** Which material this verdict covers, when part of a campaign. */
  materialId?: string;
  /** Which advertisement the material belongs to. */
  advertisementId?: string;
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
 * campaign. Optional so single-asset reviews and old stored events keep the same
 * shape. Mirrors the backend BoardEventCampaignRef in src/board/events.ts.
 */
export interface BoardEventCampaignRef {
  campaignId?: string;
  advertisementId?: string;
  materialId?: string;
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
  | {
      type: 'perceiving';
      seq: number;
      fromName: string;
      frameUrl?: string;
      index: number;
      total: number;
      stage: 'vision' | 'stt' | 'done';
      transcript?: string;
    }
  | { type: 'workitem'; seq: number; fromName: string; text: string }
  | { type: 'debate'; seq: number; fromName: string; text: string }
  | { type: 'pod-finding'; seq: number; fromName: string; pod: string; conflicts: number; text: string }
  | { type: 'mediation'; seq: number; fromName: string; resolved: boolean; text: string }
  | { type: 'adjudication'; seq: number; fromName: string; decision: string; text: string }
  | { type: 'terminal'; seq: number; fromName: string; decision: 'published' | 'spiked' | 'escalated' }
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

/** Body for POST /api/rulebooks/:region/import. md/text parse via an LLM; json validates directly. */
export interface RulebookImportRequest {
  format: 'md' | 'json' | 'text';
  content: string;
  label?: string;
}

/** One curated, ready-to-apply rulebook returned by GET /api/rulebooks/presets. */
export interface RulebookPreset {
  id: string;
  label: string;
  region: string;
  rulebook: Rulebook;
}

export interface RulebookPresetListResponse {
  presets: RulebookPreset[];
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
// THREE tiers: a Campaign is a product; it holds Advertisements; each
// Advertisement holds its own Materials (videos, posts, images, banners). One
// shared cascading dossier grounds every reviewer of every material. Mirrors
// src/domain/types.ts.

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

/** Perception artifacts from the multimodal pre-pass; all text + frames. */
export interface MaterialPerception {
  transcript?: string;
  onScreenText?: string;
  visualDescription?: string;
  detectedClaims?: string[];
  frames: string[];
}

/** The result of a band.ai review, recorded on a material so the UI reflects it. */
export interface MaterialReview {
  decision: 'published' | 'spiked' | 'escalated';
  reviewedAt: number;
  reportUrl?: string;
  reportArtifactId?: string;
  /** The full agent conversation, saved as a durable artifact (survives restarts). */
  transcriptArtifactId?: string;
  summary?: string;
}

/** Live run mirror (Stage B): a band.ai review streamed into the dashboard so the
    UI shows the workflow live. The agents POST a run + one event per lifecycle beat. */
export type RunStage =
  | 'requested'
  | 'perceiving'
  | 'reviewing'
  | 'report'
  | 'awaiting-decision'
  | 'decided'
  | 'material'
  | 'log';
export type RunStatus = 'running' | 'awaiting-decision' | 'complete' | 'error';
export interface RunArtifact {
  kind: 'image' | 'report';
  url: string;
  title?: string;
}
export interface RunEvent {
  seq: number;
  at: number;
  stage: RunStage;
  message: string;
  agent?: string;
  materialId?: string;
  artifact?: RunArtifact;
}
export interface Run {
  id: string;
  campaignId: string;
  advertisementId?: string;
  materialId?: string;
  label: string;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  events: RunEvent[];
}
export interface RunSummary {
  id: string;
  campaignId: string;
  advertisementId?: string;
  label: string;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  eventCount: number;
  lastStage?: RunStage;
  lastMessage?: string;
}

/** A single marketing creative inside an advertisement. */
export interface Material extends ContentAsset {
  kind: MaterialKind;
  videoUrl?: string;
  perception?: MaterialPerception;
  review?: MaterialReview;
}

/** A specific advertisement: a set of creatives (the materials) for one ad. */
export interface Advertisement {
  id: string;
  name: string;
  markets?: string[];
  materials: Material[];
}

/** A product launch: several advertisements sharing one cascading dossier. */
export interface Campaign {
  id: string;
  name: string;
  markets: string[];
  dossier: CampaignDossier;
  advertisements: Advertisement[];
}

/** Card-level summary returned by GET /api/campaigns. */
export interface CampaignSummary {
  id: string;
  name: string;
  markets: string[];
  advertisementCount: number;
  materialCount: number;
}

export interface CampaignListResponse {
  campaigns: CampaignSummary[];
}

export interface CampaignResponse {
  campaign: Campaign;
}

export interface AdvertisementResponse {
  campaign: Campaign;
  advertisement: Advertisement;
}

export interface MaterialResponse {
  campaign: Campaign;
  material: Material;
}

// Campaign review (observational rollup over per-material verdicts) -----------
// The rollup gates nothing (the one rule): worst-case per region across all
// materials, plus a per-advertisement breakdown and the full matrix.

export interface RollupRegion {
  region: string;
  decision: VerdictDecision;
}

export interface RollupCell {
  advertisementId: string;
  materialId: string;
  region: string;
  decision: VerdictDecision;
  rationale: string;
}

export interface AdvertisementRollup {
  advertisementId: string;
  name: string;
  worstCaseByRegion: RollupRegion[];
  matrix: RollupCell[];
}

export interface CampaignRollup {
  campaignId: string;
  worstCaseByRegion: RollupRegion[];
  perAdvertisement: AdvertisementRollup[];
  matrix: RollupCell[];
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
  /** Present when the review was scoped to a single advertisement. */
  advertisementId?: string;
  materials: string[];
}

/** Response for POST /api/videos (multipart upload). */
export interface VideoUploadResponse {
  videoUrl: string;
  campaignId?: string;
  advertisementId?: string;
  materialId?: string;
  /** True when a non-empty transcript was produced and persisted on the material. */
  transcribed?: boolean;
}

/** Response for POST /api/images (multipart upload). */
export interface ImageUploadResponse {
  url: string;
}

// Spending: live estimate of model cost, mirrors SpendSnapshot in src/models/spend.ts.
export interface ModelSpend {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  images: number;
  usd: number;
}

export interface Spending {
  totalUsd: number;
  calls: number;
  byModel: ModelSpend[];
}

// Artifacts: things an agent produced that Band cannot show inline, rendered by
// the /a/:id viewer. Mirrors src/domain/artifact.ts.
export type ArtifactKind = 'image' | 'markdown' | 'json' | 'text';

export interface Artifact {
  id: string;
  kind: ArtifactKind;
  title: string;
  createdAt: number;
  createdBy?: string;
  reviewId?: string;
  src?: string;
  content?: string;
}

export interface ArtifactResponse {
  artifact: Artifact;
}
