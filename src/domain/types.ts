// Domain model: brand DNA, per-region rulebooks, content assets, reviewer
// findings, and reconcile verdicts. Zod schemas double as validators for model
// structured output and as the source of the inferred TypeScript types.

import { z } from 'zod';

export const Severity = z.enum(['block', 'warn', 'info']);
export type Severity = z.infer<typeof Severity>;

/** A single issue a reviewer raises against a specific claim/span. */
export const Finding = z.object({
  category: z.string(),
  severity: Severity,
  claim: z.string(),
  rationale: z.string(),
  ruleId: z.string().optional(),
  requiredDisclosure: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type Finding = z.infer<typeof Finding>;

/** The shape a reviewer model returns; region/reviewer are attached by the agent. */
export const ReviewOutput = z.object({
  findings: z.array(Finding),
});
export type ReviewOutput = z.infer<typeof ReviewOutput>;

/** One reviewer's structured output for a region. */
export const ReviewResult = z.object({
  region: z.string(),
  reviewer: z.string(),
  findings: z.array(Finding),
  /** Which material this review covers, when the review is part of a campaign. */
  materialId: z.string().optional(),
  /** Which advertisement this review covers, when the review is part of a campaign. */
  advertisementId: z.string().optional(),
});
export type ReviewResult = z.infer<typeof ReviewResult>;

/** A request from reconcile to the remediation agent to fix one region. */
export const RemediationRequest = z.object({
  kind: z.literal('remediation'),
  region: z.string(),
  findings: z.array(Finding),
});
export type RemediationRequest = z.infer<typeof RemediationRequest>;

export const VerdictDecision = z.enum(['publish', 'adapt', 'escalate']);
export type VerdictDecision = z.infer<typeof VerdictDecision>;

/** Reconcile's decision for a single market. */
export const RegionVerdict = z.object({
  region: z.string(),
  decision: VerdictDecision,
  rationale: z.string(),
  /** Which material this verdict covers, when the review is part of a campaign. */
  materialId: z.string().optional(),
  /** Which advertisement this verdict covers, when the review is part of a campaign. */
  advertisementId: z.string().optional(),
});
export type RegionVerdict = z.infer<typeof RegionVerdict>;

/** One compliance rule in a region's rulebook. */
export const Rule = z.object({
  id: z.string(),
  region: z.string(),
  category: z.string(),
  severity: Severity,
  check: z.string(),
  requiredDisclosure: z.string().nullable().default(null),
  sourceUrl: z.string().optional(),
});
export type Rule = z.infer<typeof Rule>;

export const Rulebook = z.object({
  region: z.string(),
  label: z.string(),
  notLegalAdvice: z.literal(true),
  rules: z.array(Rule),
});
export type Rulebook = z.infer<typeof Rulebook>;

export const BrandDna = z.object({
  brand: z.string(),
  voice: z.array(z.string()),
  approvedVocabulary: z.array(z.string()),
  forbiddenPhrases: z.array(z.string()),
});
export type BrandDna = z.infer<typeof BrandDna>;

/** The marketing asset under review. */
export const ContentAsset = z.object({
  id: z.string(),
  /** Human-friendly campaign name for referencing it from band.ai (e.g. "Immune+ Q3"). */
  name: z.string().optional(),
  channel: z.string(),
  markets: z.array(z.string()),
  copy: z.string(),
  claim: z.string(),
  imagePrompt: z.string().optional(),
  imageUrl: z.string().optional(),
  substantiation: z.string().optional(),
});
export type ContentAsset = z.infer<typeof ContentAsset>;

// --- Campaigns (a product holds advertisements; each advertisement holds materials) ---
// THREE tiers. A Campaign is the product (a Q3 launch). It holds Advertisements
// (a creative concept like "Hero Launch"). Each Advertisement holds its own
// Materials (the videos, posts, images, banners that make up that ad). Every
// Material reuses the ContentAsset fields verbatim and adds a discriminating
// `kind`, an optional video, and optional perception artifacts. The dossier is
// the shared source-of-truth that cascades into EVERY material's review.

/** Shared source-of-truth that cascades to every material under review. */
export const CampaignDossier = z.object({
  /** Claims pre-cleared for the campaign, each assumed to carry its own backing. */
  approvedClaims: z.array(z.string()).default([]),
  /** Trials, data on file, medical/regulatory facts that substantiate the claims. */
  substantiation: z.string().default(''),
  /** Approved messaging and mandatory information the materials should carry. */
  approvedInfo: z.string().default(''),
  /** Reference sources (uploaded docs) that ground the reviewers. */
  sources: z
    .array(
      z.object({
        name: z.string(),
        kind: z.enum(['md', 'json', 'text']),
        content: z.string(),
      }),
    )
    .default([]),
});
export type CampaignDossier = z.infer<typeof CampaignDossier>;

/**
 * Perception artifacts produced by the multimodal pre-pass. All text, so they
 * cascade like the dossier and even a text-only region model benefits; `frames`
 * are hosted keyframe URLs for vision-capable models and the live "analyzing" UI.
 */
export const MaterialPerception = z.object({
  transcript: z.string().optional(),
  onScreenText: z.string().optional(),
  visualDescription: z.string().optional(),
  detectedClaims: z.array(z.string()).optional(),
  frames: z.array(z.string()).default([]),
});
export type MaterialPerception = z.infer<typeof MaterialPerception>;

export const MaterialKind = z.enum(['video', 'post', 'image', 'banner']);
export type MaterialKind = z.infer<typeof MaterialKind>;

/**
 * A single marketing material. Structurally a ContentAsset plus the material
 * fields. There is no `attachments` field any more: the Advertisement is the
 * grouping, so a material is a flat leaf.
 */
export const Material = ContentAsset.extend({
  kind: MaterialKind,
  videoUrl: z.string().optional(),
  perception: MaterialPerception.optional(),
});
export type Material = z.infer<typeof Material>;

/** An advertisement: one creative concept holding its own materials. */
export const Advertisement = z.object({
  id: z.string(),
  name: z.string(),
  /** Optional markets for the ad; a material may still narrow them via its own markets. */
  markets: z.array(z.string()).optional(),
  materials: z.array(Material).default([]),
});
export type Advertisement = z.infer<typeof Advertisement>;

/**
 * A product launch: many advertisements (each with its own materials) sharing one
 * cascading dossier. `advertisements` replaces the old flat `materials[]`.
 */
export const Campaign = z.preprocess(normalizeCampaignInput, z.object({
  id: z.string(),
  /** The product name, e.g. "Immune+ Q3". */
  name: z.string(),
  /** Default markets for the campaign; an ad/material may narrow them. */
  markets: z.array(z.string()).default([]),
  dossier: CampaignDossier,
  advertisements: z.array(Advertisement).default([]),
}));
export type Campaign = z.infer<typeof Campaign>;

/**
 * Back-compat normalizer. A campaign authored or stored with a legacy flat
 * `materials[]` (no `advertisements`) is read as a single advertisement
 * { id: 'default', name: 'Default', materials }. Anything already shaped with
 * `advertisements` is returned untouched. Used as the Campaign schema's
 * preprocess step (so old data, old seeds, and old tests still parse) and
 * exported for callers that hold a raw object.
 */
export function normalizeCampaignInput(input: unknown): unknown {
  if (input === null || typeof input !== 'object') return input;
  const obj = input as Record<string, unknown>;
  if (Array.isArray(obj.advertisements)) return obj;
  if (Array.isArray(obj.materials)) {
    const { materials, ...rest } = obj;
    return {
      ...rest,
      advertisements: [{ id: 'default', name: 'Default', materials }],
    };
  }
  return obj;
}

/** Parse any campaign-shaped value (legacy flat materials[] included) into a Campaign. */
export function normalizeCampaign(input: unknown): Campaign {
  return Campaign.parse(input);
}
