import type { AgentHandler, Mention, RoomMessage, RoomTools } from '../band/types';
import type { CompleteResult, ModelClient } from '../models/client';
import type { BrandDna, ContentAsset, Finding, ReviewResult } from '../domain/types';
import { ReviewOutput } from '../domain/types';
import type { SharedBoard } from '../board/shared';
import { matchParticipant, nameMatchesHandle } from './handles';

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

export interface VisionReviewerOptions {
  /** In-process data hub. The campaign is read from here; the finding is written here. */
  board: SharedBoard;
  reviewerName: string;
  brand: BrandDna;
  /** A vision-capable model: the campaign image is passed as vision input. */
  model: ModelClient;
  /** Region key the visual finding is filed under. Defaults to 'IMAGE'. */
  region?: string;
  /** Handle of the agent to report findings to (e.g. the reconcile agent). */
  reportToHandle?: string;
  /** band.ai room mode: ignore posts from this agent (the intake relay). */
  ignoreFromHandle?: string;
}

// The visual-compliance reviewer: the third AIML modality (vision). It reads the
// campaign IMAGE off the board, asks a vision-capable model to flag image-level
// issues, files the findings under its own lane (default 'IMAGE'), and reports to
// the reconcile agent in plain English, exactly like a region reviewer. The
// findings live on the board, never in chat.
export function makeVisionReviewer(opts: VisionReviewerOptions): AgentHandler {
  const region = opts.region ?? 'IMAGE';
  return async (message, tools, ctx) => {
    if (message.senderType !== 'agent') return;
    if (opts.ignoreFromHandle && nameMatchesHandle(message.senderName, opts.ignoreFromHandle)) return;
    const asset = opts.board.campaign(ctx.roomId);
    if (!asset) return;
    if (opts.board.reviewFor(ctx.roomId, region)) return; // already reviewed this round

    await tools.sendEvent(`${region} (visual) review: starting image review.`, 'task');

    const imageUrl = asset.imageUrl;
    const { system, user } = buildVisionPrompt(opts, asset, imageUrl);
    const res = await opts.model.complete({
      system,
      messages: [{ role: 'user', content: user }],
      jsonSchema: REVIEW_OUTPUT_JSON_SCHEMA,
      ...(imageUrl ? { images: [imageUrl] } : {}),
    });
    const review: ReviewResult = { region, reviewer: opts.reviewerName, findings: parseFindings(res) };
    opts.board.addReview(ctx.roomId, review);

    const blocking = review.findings.filter((f) => f.severity === 'block').length;
    await tools.sendEvent(`${region} (visual) review: ${review.findings.length} finding(s), ${blocking} blocking.`, 'task');
    const target = await resolveReportTarget(tools, opts.reportToHandle, message);
    await tools.sendMessage(visualMessage(review.findings), [target]);
  };
}

function buildVisionPrompt(
  opts: VisionReviewerOptions,
  asset: ContentAsset,
  imageUrl: string | undefined,
): { system: string; user: string } {
  const system = [
    `You are the visual-compliance reviewer for ${opts.brand.brand}. This is a demo, NOT legal advice.`,
    `Inspect the campaign IMAGE for compliance and brand issues: unsubstantiated visual health claims, an efficacy "halo", missing on-image disclosures, forbidden or off-brand imagery.`,
    `Brand voice: ${opts.brand.voice.join(', ')}. Forbidden phrases: ${opts.brand.forbiddenPhrases.join(', ')}.`,
    `Use an image-related category such as "imagery", "visual_claim", or "image_disclosure". Quote the visual element you are flagging in the claim field.`,
    `Return JSON {"findings":[{"category","severity":"block"|"warn"|"info","claim","rationale","ruleId"?,"requiredDisclosure"?,"confidence"?}]}. If the image is clear, return {"findings":[]}.`,
  ].join('\n\n');
  const user = imageUrl
    ? `The campaign image is attached. Copy context (JSON):\n${JSON.stringify(asset, null, 2)}`
    : `No image was rendered yet; assess the intended image from this prompt: ${asset.imagePrompt ?? '(none)'}.\nAsset (JSON):\n${JSON.stringify(asset, null, 2)}`;
  return { system, user };
}

/** Compose a plain-English visual report to Reconcile from the structured findings. */
function visualMessage(findings: Finding[]): string {
  const first = findings[0];
  if (!first) {
    return `Visual review: the image is clear. No image-level issues.`;
  }
  const firstBlock = findings.find((f) => f.severity === 'block');
  if (firstBlock) {
    const fix =
      typeof firstBlock.requiredDisclosure === 'string' && firstBlock.requiredDisclosure.length > 0
        ? 'It is fixable by adding the required on-image disclosure.'
        : 'This is not fixable by a simple disclosure.';
    return `Visual review: I have to flag the image. ${firstBlock.rationale} ${fix}`;
  }
  return `Visual review: the image can run, but note: ${first.rationale}`;
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
