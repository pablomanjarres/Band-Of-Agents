import type { AgentHandler, Mention, Participant, RoomMessage, RoomTools } from '../band/types';
import type { RegionVerdict, ReviewResult } from '../domain/types';
import { ReviewResult as ReviewResultSchema } from '../domain/types';
import { matchParticipant } from './handles';

export interface Precedent {
  roomId: string;
  regions: string[];
  decision: string;
}

export interface ReconcileOptions {
  /** Regions whose reviews to wait for before deciding, e.g. ['US','EU']. */
  expectedRegions: string[];
  /** Handle of the coordinator to report the verdict to. */
  coordinatorHandle?: string;
  /** Handle of the human reviewer to escalate to (e.g. the compliance lead). */
  humanHandle?: string;
  /** Handle of the remediation agent to hand 'adapt' regions to. */
  remediationHandle?: string;
  /** Called when a human rules on an escalation; the decision becomes precedent. */
  logPrecedent?: (precedent: Precedent) => void;
}

// The reconcile agent: collects each region reviewer's findings; once all
// expected regions are in, it issues a per-region verdict, surfaces the
// cross-region conflict, routes 'adapt' regions to remediation, and escalates an
// unresolvable block to the human. When the human rules, it records precedent.
export function makeReconcile(opts: ReconcileOptions): AgentHandler {
  const reviewsByRoom = new Map<string, Map<string, ReviewResult>>();
  const pendingByRoom = new Map<string, string[]>();

  return async (message, tools) => {
    if (message.senderType === 'user') {
      const regions = pendingByRoom.get(message.roomId);
      if (!regions) return;
      pendingByRoom.delete(message.roomId);
      opts.logPrecedent?.({ roomId: message.roomId, regions, decision: message.content });
      await tools.sendEvent(
        `Human decision recorded for ${regions.join('/')}: "${message.content}". Logged as precedent.`,
        'decision',
      );
      return;
    }

    if (message.senderType !== 'agent') return;
    const review = tryParseReview(message.content);
    if (!review) return;

    const collected = reviewsByRoom.get(message.roomId) ?? new Map<string, ReviewResult>();
    collected.set(review.region, review);
    reviewsByRoom.set(message.roomId, collected);
    await tools.sendEvent(
      `Received ${review.region} review (${review.findings.length} finding(s)). ${collected.size}/${opts.expectedRegions.length} in.`,
      'reconcile',
    );
    if (!opts.expectedRegions.every((r) => collected.has(r))) return;

    const verdicts = opts.expectedRegions.map((r) => decideRegion(collected.get(r)!));

    const canPublish = verdicts.filter((v) => v.decision === 'publish').map((v) => v.region);
    const adaptRegions = verdicts.filter((v) => v.decision === 'adapt').map((v) => v.region);
    const escalateRegions = verdicts.filter((v) => v.decision === 'escalate').map((v) => v.region);
    const blocked = verdicts.filter((v) => v.decision !== 'publish').map((v) => v.region);
    const conflict = canPublish.length > 0 && blocked.length > 0;

    await tools.sendEvent(
      `Verdicts: ${verdicts.map((v) => `${v.region}=${v.decision}`).join(', ')}.` +
        (conflict ? ` Cross-region conflict: ${canPublish.join('/')} can publish while ${blocked.join('/')} cannot.` : ''),
      'verdict',
    );

    const coordTarget = await resolveByHandle(tools, opts.coordinatorHandle, message);
    await tools.sendMessage(JSON.stringify({ verdicts, conflict }), [coordTarget]);

    // Route fixable regions to remediation.
    if (adaptRegions.length > 0 && opts.remediationHandle) {
      const remediation = await findParticipant(tools, opts.remediationHandle, 'agent');
      if (remediation) {
        for (const region of adaptRegions) {
          const findings = collected.get(region)?.findings ?? [];
          await tools.sendMessage(
            JSON.stringify({ kind: 'remediation', region, findings }),
            [{ id: remediation.id, handle: remediation.handle }],
          );
        }
        await tools.sendEvent(`Requested remediation for ${adaptRegions.join('/')}.`, 'remediation');
      }
    }

    // Escalate unresolvable blocks to the human.
    if (escalateRegions.length > 0 && opts.humanHandle) {
      const human = await findParticipant(tools, opts.humanHandle, 'user');
      if (human) {
        const reasons = verdicts
          .filter((v) => escalateRegions.includes(v.region))
          .map((v) => `${v.region}: ${v.rationale}`)
          .join(' ');
        await tools.sendEvent(`Escalating ${escalateRegions.join('/')} to ${human.handle} for a human decision.`, 'escalation');
        await tools.sendMessage(
          `Escalation for ${escalateRegions.join('/')}. ${reasons} Please rule: approve, reject, or request changes.`,
          [{ id: human.id, handle: human.handle }],
        );
        pendingByRoom.set(message.roomId, escalateRegions);
      } else {
        await tools.sendEvent(`Need to escalate ${escalateRegions.join('/')} but ${opts.humanHandle} is not in the room.`, 'escalation');
      }
    }

    reviewsByRoom.delete(message.roomId);
  };
}

function decideRegion(review: ReviewResult): RegionVerdict {
  const blocks = review.findings.filter((f) => f.severity === 'block');
  if (blocks.length === 0) {
    return { region: review.region, decision: 'publish', rationale: 'No blocking findings.' };
  }
  const fixable = (b: { requiredDisclosure?: string | null }) =>
    typeof b.requiredDisclosure === 'string' && b.requiredDisclosure.length > 0;
  if (blocks.every(fixable)) {
    return {
      region: review.region,
      decision: 'adapt',
      rationale: `Blocking findings are remediable via disclosures: ${blocks.map((b) => b.ruleId ?? b.category).join(', ')}.`,
    };
  }
  return {
    region: review.region,
    decision: 'escalate',
    rationale: `Unresolvable blocking finding(s): ${blocks
      .filter((b) => !fixable(b))
      .map((b) => b.ruleId ?? b.category)
      .join(', ')}.`,
  };
}

function tryParseReview(content: string): ReviewResult | null {
  try {
    const parsed = ReviewResultSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function findParticipant(
  tools: RoomTools,
  handle: string,
  type: 'agent' | 'user',
): Promise<Participant | undefined> {
  return matchParticipant(await tools.getParticipants(), handle, type);
}

async function resolveByHandle(
  tools: RoomTools,
  handle: string | undefined,
  message: RoomMessage,
): Promise<Mention> {
  if (handle) {
    const found = await findParticipant(tools, handle, 'agent');
    if (found) return { id: found.id, handle: found.handle };
  }
  return { id: message.senderId };
}
