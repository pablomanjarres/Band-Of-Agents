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
  /** Human-friendly campaign name for referencing it from band.ai (e.g. "Lumavida-Q3"). */
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
