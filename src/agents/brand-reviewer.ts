import type { AgentHandler, Mention, RoomMessage, RoomTools } from '../band/types';
import type { CompleteResult, ModelClient } from '../models/client';
import type { BrandDna, ReviewResult } from '../domain/types';
import { ReviewOutput } from '../domain/types';
import { tryParseAsset } from '../domain/load';
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
  brand: BrandDna;
  model: ModelClient;
  reviewerName?: string;
  reportToHandle?: string;
  /** band.ai room mode: ignore posts from this agent (the intake relay) so only the coordinator's forward triggers a review. */
  ignoreFromHandle?: string;
}

// The brand-consistency reviewer: keeps localized versions on-voice and free of
// forbidden phrasing. Reports findings under the 'BRAND' region so reconcile can
// treat brand consistency as its own gate alongside the market regions.
export function makeBrandReviewer(opts: BrandReviewerOptions): AgentHandler {
  const reviewerName = opts.reviewerName ?? 'Brand Reviewer';
  return async (message, tools) => {
    if (message.senderType !== 'agent') return;
    if (opts.ignoreFromHandle && nameMatchesHandle(message.senderName, opts.ignoreFromHandle)) return;
    const asset = tryParseAsset(message.content);
    if (!asset) return;

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

    const blocking = review.findings.filter((f) => f.severity === 'block').length;
    await tools.sendEvent(`Brand review of "${asset.id}": ${review.findings.length} finding(s), ${blocking} blocking.`, 'review');
    const target = await resolveTarget(tools, opts.reportToHandle, message);
    await tools.sendMessage(JSON.stringify(review), [target]);
  };
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
