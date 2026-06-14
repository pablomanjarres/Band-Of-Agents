import type { AgentHandler, Mention, RoomMessage, RoomTools } from '../band/types';
import type { CompleteResult, ModelClient } from '../models/client';
import type { BrandDna, Finding, ReviewResult } from '../domain/types';
import { ReviewOutput } from '../domain/types';
import type { SharedBoard } from '../board/shared';
import { matchParticipant, nameMatchesHandle } from './handles';

const BRAND_OUTPUT_JSON_SCHEMA = {
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

export interface BrandReviewerOptions {
  /** In-process data hub. The campaign is read from here; the finding is written here. */
  board: SharedBoard;
  brand: BrandDna;
  model: ModelClient;
  reviewerName?: string;
  reportToHandle?: string;
  /** band.ai room mode: ignore posts from this agent (the intake relay) so only the coordinator's forward triggers a review. */
  ignoreFromHandle?: string;
}

// The brand-consistency reviewer: keeps localized versions on-voice and free of
// forbidden phrasing. It reads the campaign off the board, reviews it, files the
// finding under the 'BRAND' region on the board so reconcile treats brand
// consistency as its own gate, and reports to reconcile in plain English.
export function makeBrandReviewer(opts: BrandReviewerOptions): AgentHandler {
  const reviewerName = opts.reviewerName ?? 'Brand Reviewer';
  return async (message, tools, ctx) => {
    if (message.senderType !== 'agent') return;
    if (opts.ignoreFromHandle && nameMatchesHandle(message.senderName, opts.ignoreFromHandle)) return;
    const asset = opts.board.campaign(ctx.roomId);
    if (!asset) return;
    if (opts.board.reviewFor(ctx.roomId, 'BRAND')) return; // already reviewed this round

    const system = [
      `You are the brand-consistency reviewer for ${opts.brand.brand}. This is a demo, NOT legal advice.`,
      `Keep localized versions on-brand. Voice: ${opts.brand.voice.join(', ')}. Approved vocabulary: ${opts.brand.approvedVocabulary.join(', ')}. Forbidden phrases: ${opts.brand.forbiddenPhrases.join(', ')}.`,
      `Flag off-voice copy or any forbidden phrase. Return JSON {"findings":[{"category","severity":"block"|"warn"|"info","claim","rationale","ruleId"?,"requiredDisclosure"?,"confidence"?}]}. If on-brand, return {"findings":[]}.`,
    ].join('\n\n');

    const res = await opts.model.complete({
      system,
      messages: [{ role: 'user', content: `Asset (JSON):\n${JSON.stringify(asset, null, 2)}` }],
      jsonSchema: BRAND_OUTPUT_JSON_SCHEMA,
    });
    const review: ReviewResult = { region: 'BRAND', reviewer: reviewerName, findings: parseFindings(res) };
    opts.board.addReview(ctx.roomId, review);

    const blocking = review.findings.filter((f) => f.severity === 'block').length;
    await tools.sendEvent(`Brand review: ${review.findings.length} finding(s), ${blocking} blocking.`, 'review');
    const target = await resolveTarget(tools, opts.reportToHandle, message);
    await tools.sendMessage(brandMessage(review.findings), [target]);
  };
}

/** Compose a plain-English brand report to Reconcile from the structured findings. */
function brandMessage(findings: Finding[]): string {
  const first = findings[0];
  if (!first) {
    return `Brand review: this one is clear. No blocking issues from my rules.`;
  }
  const firstBlock = findings.find((f) => f.severity === 'block');
  if (firstBlock) {
    const fix =
      typeof firstBlock.requiredDisclosure === 'string' && firstBlock.requiredDisclosure.length > 0
        ? 'It is fixable by adding the required disclosure.'
        : 'This is not fixable by a simple disclosure.';
    return `Brand review: I have to flag this. ${firstBlock.rationale} ${fix}`;
  }
  return `Brand review: it can run, but note: ${first.rationale}`;
}

function parseFindings(res: CompleteResult): ReviewResult['findings'] {
  const raw = res.json ?? safeJsonParse(res.text);
  const parsed = ReviewOutput.safeParse(raw);
  return parsed.success ? parsed.data.findings : [];
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function resolveTarget(
  tools: RoomTools,
  handle: string | undefined,
  message: RoomMessage,
): Promise<Mention> {
  if (handle) {
    const found = matchParticipant(await tools.getParticipants(), handle, 'agent');
    if (found) return { id: found.id, handle: found.handle };
  }
  return { id: message.senderId, ...(message.senderName ? { handle: message.senderName } : {}) };
}
