import type { AgentHandler, Mention, RoomMessage, RoomTools } from '../band/types';
import type { CompleteResult, ModelClient } from '../models/client';
import type { BrandDna, ContentAsset, ReviewResult, Rulebook } from '../domain/types';
import { ReviewOutput } from '../domain/types';
import { tryParseAsset } from '../domain/load';
import { matchParticipant, nameMatchesHandle } from './handles';

export interface RegionReviewerOptions {
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

// A region-compliance reviewer: when the coordinator hands it the asset, it
// reviews against its own rulebook, posts a visible summary, and reports the
// structured findings to the reconcile agent (or back to the requester).
export function makeRegionReviewer(opts: RegionReviewerOptions): AgentHandler {
  return async (message, tools) => {
    if (message.senderType !== 'agent') return;
    if (opts.ignoreFromHandle && nameMatchesHandle(message.senderName, opts.ignoreFromHandle)) return;
    const asset = tryParseAsset(message.content);
    if (!asset) return;

    const { system, user } = buildReviewPrompt(opts, asset);
    const res = await opts.model.complete({
      system,
      messages: [{ role: 'user', content: user }],
      jsonSchema: REVIEW_OUTPUT_JSON_SCHEMA,
    });
    const review = toReviewResult(res, opts);

    const blocking = review.findings.filter((f) => f.severity === 'block').length;
    await tools.sendEvent(
      `${opts.region} review of "${asset.id}": ${review.findings.length} finding(s), ${blocking} blocking.`,
      'review',
    );
    const target = await resolveReportTarget(tools, opts.reportToHandle, message);
    await tools.sendMessage(JSON.stringify(review), [target]);
  };
}

function buildReviewPrompt(
  opts: RegionReviewerOptions,
  asset: ContentAsset,
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
  const system = [
    `You are the ${opts.region} marketing-compliance reviewer (${rulebook.label}). This is a demo, NOT legal advice.`,
    `Mandate: flag every claim in the asset that violates a ${opts.region} rule below. Quote the exact offending claim span.`,
    `Brand voice: ${opts.brand.voice.join(', ')}. Forbidden phrases: ${opts.brand.forbiddenPhrases.join(', ')}.`,
    `${opts.region} rulebook:\n${rules}`,
    precedentBlock,
    `Return JSON {"findings":[{"category","severity":"block"|"warn"|"info","claim","rationale","ruleId"?,"requiredDisclosure"?,"confidence"?}]}. If fully compliant, return {"findings":[]}.`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const user = `Asset under review (JSON):\n${JSON.stringify(asset, null, 2)}`;
  return { system, user };
}

function toReviewResult(res: CompleteResult, opts: RegionReviewerOptions): ReviewResult {
  const raw = res.json ?? safeJsonParse(res.text);
  const parsed = ReviewOutput.safeParse(raw);
  const findings = parsed.success ? parsed.data.findings : [];
  return { region: opts.region, reviewer: opts.reviewerName, findings };
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
