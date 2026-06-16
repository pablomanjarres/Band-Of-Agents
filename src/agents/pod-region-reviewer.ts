import type { AgentHandler, Mention, RoomMessage, RoomTools } from '../band/types';
import type { CompleteResult, ModelClient } from '../models/client';
import type { BrandDna, ContentAsset, ReviewResult, Rulebook } from '../domain/types';
import type { PodHub } from '../board/pod-hub';
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
  /** When set, read the asset from the hub (the lead dispatches plain English). */
  hub?: PodHub;
}

const REBUTTAL_JSON_SCHEMA = {
  type: 'object',
  properties: {
    stance: { type: 'string', enum: ['hold', 'concede'] },
    rationale: { type: 'string' },
  },
  required: ['stance', 'rationale'],
} as const;

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
    // Debate branch: a challenge arrives as JSON (back-compat) or as prose with the
    // details on the hub. We hold or concede.
    let parsed: { kind?: string; claim?: string; peerRegion?: string; peerRationale?: string } | null = null;
    try { parsed = JSON.parse(message.content); } catch { parsed = null; }
    const hubChallenge = opts.hub?.challenge(message.roomId, opts.region);
    const challenge = (parsed && parsed.kind === 'challenge') ? parsed : (hubChallenge ? { kind: 'challenge', ...hubChallenge } : null);
    if (challenge && challenge.kind === 'challenge') {
      let out: { stance?: string; rationale?: string } = {};
      try {
        const res = await opts.model.complete({
          system: `You are the ${opts.region} reviewer. A peer (${challenge.peerRegion}) argues: "${challenge.peerRationale}". Decide whether to hold your block on "${challenge.claim}" under the ${opts.region} rulebook, or concede. Answer JSON.`,
          messages: [{ role: 'user', content: `Claim under dispute: ${challenge.claim}` }],
          jsonSchema: REBUTTAL_JSON_SCHEMA,
        });
        out = (res.json ?? {}) as { stance?: string; rationale?: string };
      } catch (err) {
        // On a model error, hold the block (the safe default) and still reply, so the
        // Reg Lead's rebuttal round is not left waiting.
        console.warn(`[${opts.region}] rebuttal failed (continuing, holding):`, (err as Error)?.message ?? err);
      }
      const stance = out.stance ?? 'hold';
      const target = matchParticipant(await tools.getParticipants(), opts.reportToHandle ?? '', 'agent') ?? null;
      const mention = target ? [{ id: target.id, handle: target.handle }] : [{ id: message.senderId }];
      await tools.sendEvent(`${opts.reviewerName} rebuts on "${challenge.claim}": ${stance}`, 'debate', { region: opts.region });
      if (opts.hub) {
        // On concede, downgrade the blocked finding on the hub; the lead re-reads it.
        if (stance === 'concede') {
          const updated = opts.hub.finding(message.roomId, opts.region).map((f) => (f.claim === challenge.claim && f.severity === 'block' ? { ...f, severity: 'warn' as const } : f));
          opts.hub.setFinding(message.roomId, opts.region, updated);
        }
        opts.hub.clearChallenge(message.roomId, opts.region);
        await tools.sendMessage(`${opts.reviewerName}: ${stance === 'concede' ? 'conceding' : 'holding the block'} on "${challenge.claim}".`, mention);
      } else {
        await tools.sendMessage(JSON.stringify({ kind: 'rebuttal', region: opts.region, claim: challenge.claim, stance, rationale: out.rationale ?? '' }), mention);
      }
      return;
    }
    if (message.senderType !== 'agent') return;
    if (opts.ignoreFromHandle && nameMatchesHandle(message.senderName, opts.ignoreFromHandle)) return;
    const asset = tryParseAsset(message.content) ?? opts.hub?.asset(message.roomId);
    if (!asset) return;

    // Open the per-region review on Band's task channel (a 'task' lifecycle, not a
    // thought), so per-region progress shows as task state rather than chatter.
    await tools.sendEvent(`${opts.region} review: starting compliance review.`, 'task');

    const { system, user } = buildReviewPrompt(opts, asset);
    // A reviewer whose model call fails must STILL report, or the Reg Lead waits
    // forever for it and the regulatory pod never files. Degrade to an empty review.
    let review: ReviewResult;
    try {
      const res = await opts.model.complete({
        system,
        messages: [{ role: 'user', content: user }],
        jsonSchema: REVIEW_OUTPUT_JSON_SCHEMA,
      });
      review = toReviewResult(res, opts);
    } catch (err) {
      console.warn(`[${opts.region}] review failed (continuing):`, (err as Error)?.message ?? err);
      review = { region: opts.region, reviewer: opts.reviewerName, findings: [] };
    }

    const blocking = review.findings.filter((f) => f.severity === 'block').length;
    await tools.sendEvent(
      `${opts.region} review of "${asset.id}": ${review.findings.length} finding(s), ${blocking} blocking.`,
      'task',
    );
    const target = await resolveReportTarget(tools, opts.reportToHandle, message);
    if (opts.hub) {
      opts.hub.setFinding(message.roomId, opts.region, review.findings);
      const detail = review.findings.length ? `: ${topRegionFindings(review.findings)}` : '';
      await tools.sendMessage(`${opts.reviewerName}: ${review.findings.length} finding(s)${blocking ? `, ${blocking} blocking` : ''}${detail}.`, [target]);
    } else {
      await tools.sendMessage(JSON.stringify(review), [target]);
    }
  };
}

// A short, room-friendly summary of the first finding or two, so the chat shows
// WHAT was flagged, not just a count.
function topRegionFindings(findings: ReviewResult['findings']): string {
  const text = (f: ReviewResult['findings'][number]): string => {
    const s = f.rationale || f.claim || f.category || f.ruleId || 'issue';
    return s.length > 90 ? `${s.slice(0, 87)}...` : s;
  };
  return findings.slice(0, 2).map(text).join('; ');
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
