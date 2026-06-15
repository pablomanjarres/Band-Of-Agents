import type { AgentHandler, Mention, RoomMessage, RoomTools } from '../band/types';
import type { CompleteResult, ModelClient } from '../models/client';
import type {
  BrandDna,
  CampaignDossier,
  ContentAsset,
  Finding,
  MaterialPerception,
  ReviewResult,
  Rulebook,
} from '../domain/types';
import { ReviewOutput } from '../domain/types';
import type { SharedBoard } from '../board/shared';
import { matchParticipant, nameMatchesHandle } from './handles';

export interface RegionReviewerOptions {
  /** In-process data hub. The campaign is read from here; the finding is written here. */
  board: SharedBoard;
  region: string;
  reviewerName: string;
  rulebook: Rulebook;
  brand: BrandDna;
  model: ModelClient;
  /** Handle of the agent to report findings to (e.g. the reconcile agent). */
  reportToHandle?: string;
  /** band.ai room mode: ignore posts from this agent (the intake relay) so only the coordinator's forward triggers a review. */
  ignoreFromHandle?: string;
  /** Read the current rulebook from the store per review, so UI edits apply to the next band.ai review. Falls back to `rulebook`. */
  getRulebook?: () => Rulebook;
  /** Recent human-decision precedents (gray-area rulings) to weigh on borderline calls. Read per review. */
  precedents?: () => string[];
}

// JSON Schema handed to the model for structured output. Mirrors ReviewOutput.
const REVIEW_OUTPUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'severity', 'claim', 'rationale'],
        properties: {
          category: { type: 'string' },
          severity: { type: 'string', enum: ['block', 'warn', 'info'] },
          claim: { type: 'string' },
          rationale: { type: 'string' },
          ruleId: { type: 'string' },
          requiredDisclosure: { type: ['string', 'null'] },
          confidence: { type: 'number' },
        },
      },
    },
  },
} as const;

// A region-compliance reviewer. When another agent's message signals a (re-)review
// is open on the board, it reads the campaign off the board, reviews against its
// own rulebook, files the structured findings on the board, and reports to the
// reconcile agent in plain English. The findings live on the board, never in chat.
export function makeRegionReviewer(opts: RegionReviewerOptions): AgentHandler {
  return async (message, tools, ctx) => {
    if (message.senderType !== 'agent') return;
    if (opts.ignoreFromHandle && nameMatchesHandle(message.senderName, opts.ignoreFromHandle)) return;
    const asset = opts.board.campaign(ctx.roomId);
    if (!asset) return;
    if (opts.board.reviewFor(ctx.roomId, opts.region)) return; // already reviewed this round

    // Campaign context cascades into the prompt: the dossier (authoritative for
    // the whole campaign) and this material's perception artifacts (if a prior
    // pass produced them). Both are absent for a plain single-asset review.
    const dossier = opts.board.dossier(ctx.roomId);
    const materialId = opts.board.materialId(ctx.roomId);
    const { system, user } = buildReviewPrompt(opts, asset, dossier, perceptionOf(asset));
    const res = await opts.model.complete({
      system,
      messages: [{ role: 'user', content: user }],
      jsonSchema: REVIEW_OUTPUT_JSON_SCHEMA,
    });
    const review = toReviewResult(res, opts, materialId);
    opts.board.addReview(ctx.roomId, review);

    const blocking = review.findings.filter((f) => f.severity === 'block').length;
    await tools.sendEvent(`${opts.region} review: ${review.findings.length} finding(s), ${blocking} blocking.`, 'review');
    const target = await resolveReportTarget(tools, opts.reportToHandle, message);
    await tools.sendMessage(reviewMessage(opts.region, review.findings), [target]);
  };
}

/** Compose a plain-English report to Reconcile from the structured findings. */
function reviewMessage(region: string, findings: Finding[]): string {
  const first = findings[0];
  if (!first) {
    return `${region} review: this one is clear. No blocking issues from my rules.`;
  }
  const firstBlock = findings.find((f) => f.severity === 'block');
  if (firstBlock) {
    const fix =
      typeof firstBlock.requiredDisclosure === 'string' && firstBlock.requiredDisclosure.length > 0
        ? 'It is fixable by adding the required disclosure.'
        : 'This is not fixable by a simple disclosure.';
    return `${region} review: I have to flag this. ${firstBlock.rationale} ${fix}`;
  }
  return `${region} review: it can run, but note: ${first.rationale}`;
}

function buildReviewPrompt(
  opts: RegionReviewerOptions,
  asset: ContentAsset,
  dossier?: CampaignDossier,
  perception?: MaterialPerception,
): { system: string; user: string } {
  const rulebook = opts.getRulebook?.() ?? opts.rulebook;
  const rules = rulebook.rules
    .map(
      (r) =>
        `- [${r.severity}] ${r.id} (${r.category}): ${r.check}` +
        (r.requiredDisclosure ? ` Required disclosure: ${r.requiredDisclosure}.` : ''),
    )
    .join('\n');
  const precedents = opts.precedents?.() ?? [];
  const precedentBlock = precedents.length
    ? `Precedent (past human rulings on gray areas); weigh these for borderline calls:\n${precedents.map((p) => `- ${p}`).join('\n')}`
    : '';
  // The campaign dossier is the authoritative, pre-cleared source-of-truth. A
  // claim backed here (e.g. "clinically proven" with substantiation on file) is
  // judged against that backing, so one region may publish while another still
  // demands a disclosure. Editing the dossier once re-grounds every material.
  const dossierBlock = dossierPrompt(dossier);
  const system = [
    `You are the ${opts.region} marketing-compliance reviewer (${rulebook.label}). This is a demo, NOT legal advice.`,
    `Mandate: flag every claim in the material that violates a ${opts.region} rule below. Quote the exact offending claim span.`,
    `Brand voice: ${opts.brand.voice.join(', ')}. Forbidden phrases: ${opts.brand.forbiddenPhrases.join(', ')}.`,
    `${opts.region} rulebook:\n${rules}`,
    dossierBlock,
    precedentBlock,
    `Return JSON {"findings":[{"category","severity":"block"|"warn"|"info","claim","rationale","ruleId"?,"requiredDisclosure"?,"confidence"?}]}. If fully compliant, return {"findings":[]}.`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const perceptionBlock = perceptionPrompt(perception);
  const user = [
    `Material under review (JSON):\n${JSON.stringify(asset, null, 2)}`,
    perceptionBlock,
  ]
    .filter(Boolean)
    .join('\n\n');
  return { system, user };
}

/**
 * Render the campaign dossier as authoritative context. Clearly labeled so the
 * reviewer treats approved claims and substantiation as pre-cleared backing, not
 * as part of the material's own copy. Returns '' when there is no dossier.
 */
function dossierPrompt(dossier?: CampaignDossier): string {
  if (!dossier) return '';
  const parts: string[] = [];
  if (dossier.approvedClaims.length > 0) {
    parts.push(`Pre-approved claims (cleared for this campaign, treat as substantiated):\n${dossier.approvedClaims.map((c) => `- ${c}`).join('\n')}`);
  }
  if (dossier.substantiation.trim()) {
    parts.push(`Substantiation (trials, data on file, regulatory facts):\n${dossier.substantiation.trim()}`);
  }
  if (dossier.approvedInfo.trim()) {
    parts.push(`Approved messaging and mandatory information:\n${dossier.approvedInfo.trim()}`);
  }
  if (dossier.sources.length > 0) {
    const excerpts = dossier.sources
      .map((s) => `- ${s.name} (${s.kind}): ${excerpt(s.content)}`)
      .join('\n');
    parts.push(`Reference source excerpts:\n${excerpts}`);
  }
  if (parts.length === 0) return '';
  return `Campaign dossier (AUTHORITATIVE shared source-of-truth; judge the material's claims against this):\n\n${parts.join('\n\n')}`;
}

/**
 * Render the material's perception artifacts (transcript, on-screen text, visual
 * description, detected claims) so even a text-only region model reviews what the
 * material actually shows and says. Returns '' when there is no perception.
 */
function perceptionPrompt(perception?: MaterialPerception): string {
  if (!perception) return '';
  const parts: string[] = [];
  if (perception.transcript?.trim()) parts.push(`Audio transcript:\n${perception.transcript.trim()}`);
  if (perception.onScreenText?.trim()) parts.push(`On-screen text (OCR):\n${perception.onScreenText.trim()}`);
  if (perception.visualDescription?.trim()) parts.push(`Visual description:\n${perception.visualDescription.trim()}`);
  if (perception.detectedClaims && perception.detectedClaims.length > 0) {
    parts.push(`Claims read off the material:\n${perception.detectedClaims.map((c) => `- ${c}`).join('\n')}`);
  }
  if (parts.length === 0) return '';
  return `Perception (what the material's video/image actually shows and says; review these too):\n\n${parts.join('\n\n')}`;
}

/** Trim a long source body so a dossier excerpt stays readable in the prompt. */
function excerpt(content: string, max = 600): string {
  const trimmed = content.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}...` : trimmed;
}

/**
 * A Material is structurally a ContentAsset with an optional perception field, so
 * at runtime board.campaign(key) may carry one. Read it defensively without
 * widening the board's ContentAsset typing.
 */
function perceptionOf(asset: ContentAsset): MaterialPerception | undefined {
  const maybe = (asset as { perception?: MaterialPerception }).perception;
  return maybe;
}

function toReviewResult(
  res: CompleteResult,
  opts: RegionReviewerOptions,
  materialId?: string,
): ReviewResult {
  const raw = res.json ?? safeJsonParse(res.text);
  const parsed = ReviewOutput.safeParse(raw);
  const findings = parsed.success ? parsed.data.findings : [];
  return {
    region: opts.region,
    reviewer: opts.reviewerName,
    findings,
    ...(materialId !== undefined ? { materialId } : {}),
  };
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function resolveReportTarget(
  tools: RoomTools,
  reportToHandle: string | undefined,
  message: RoomMessage,
): Promise<Mention> {
  if (reportToHandle) {
    const target = matchParticipant(await tools.getParticipants(), reportToHandle, 'agent');
    if (target) return { id: target.id, handle: target.handle };
  }
  return { id: message.senderId, ...(message.senderName ? { handle: message.senderName } : {}) };
}
