import type { AgentHandler, Mention, Participant, RoomMessage, RoomTools } from '../band/types';
import type { Finding, RegionVerdict, ReviewResult } from '../domain/types';
import type { SharedBoard } from '../board/shared';
import { matchParticipant, nameMatchesHandle } from './handles';

export interface Precedent {
  roomId: string;
  regions: string[];
  decision: string;
}

export interface ReconcileOptions {
  /** In-process data hub. Reviews and verdicts live here; the room stays plain English. */
  board: SharedBoard;
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
  /** band.ai room mode: accept the human ruling relayed by this intake/proxy agent. */
  humanProxyHandle?: string;
}

const MAX_REMEDIATION_ROUNDS = 1;

// The reconcile agent. As each reviewer reports, it reads the accumulated findings
// off the SharedBoard; once all expected regions are in, it decides a per-region
// verdict, records it on the board, and routes the room in plain English: it tells
// the coordinator the outcome, asks remediation to adapt fixable regions, and
// escalates unresolvable blocks to the human. When the human rules, it records
// precedent. All structured data is read/written on the board, not the chat.
export function makeReconcile(opts: ReconcileOptions): AgentHandler {
  const pendingByRoom = new Map<string, string[]>();

  return async (message, tools, ctx) => {
    const fromHumanProxy =
      opts.humanProxyHandle !== undefined &&
      message.senderType === 'agent' &&
      nameMatchesHandle(message.senderName, opts.humanProxyHandle);

    // A human ruling on a pending escalation.
    if (message.senderType === 'user' || fromHumanProxy) {
      const regions = pendingByRoom.get(ctx.roomId);
      if (!regions) return;
      pendingByRoom.delete(ctx.roomId);
      opts.logPrecedent?.({ roomId: ctx.roomId, regions, decision: message.content });
      opts.board.decided(ctx.roomId, message.content);
      await tools.sendEvent(
        `Human decision recorded for ${regions.join('/')}: "${message.content}". Logged as precedent.`,
        'decision',
      );
      return;
    }

    if (message.senderType !== 'agent') return;
    if (!opts.board.campaign(ctx.roomId)) return;
    // Decide once per round: reconcile is pinged once per reviewer report plus the
    // coordinator's recruit, so skip if this round's verdicts are already in. A
    // re-review clears them (startReReview), reopening the decision for that round.
    if (opts.board.hasVerdicts(ctx.roomId)) return;

    // A reviewer just reported. Read the running tally off the board.
    const reviews = opts.board.reviews(ctx.roomId);
    const have = new Set(reviews.map((r) => r.region));
    await tools.sendEvent(
      `${have.size}/${opts.expectedRegions.length} reviews in.`,
      'reconcile',
    );
    if (!opts.expectedRegions.every((r) => have.has(r))) return; // wait for the rest

    const byRegion = new Map<string, ReviewResult>(reviews.map((r) => [r.region, r]));
    const verdicts = opts.expectedRegions.map((r) => decideRegion(byRegion.get(r)!));

    // Re-review cap: once a region has been remediated MAX_REMEDIATION_ROUNDS
    // times, a still-fixable 'adapt' escalates to the human instead of looping.
    if (opts.board.remediationRounds(ctx.roomId) >= MAX_REMEDIATION_ROUNDS) {
      for (const v of verdicts) {
        if (v.decision === 'adapt') {
          v.decision = 'escalate';
          v.rationale = `Remediation exhausted; ${v.rationale}`;
        }
      }
    }

    const canPublish = verdicts.filter((v) => v.decision === 'publish').map((v) => v.region);
    const adaptRegions = verdicts.filter((v) => v.decision === 'adapt').map((v) => v.region);
    const escalateRegions = verdicts.filter((v) => v.decision === 'escalate').map((v) => v.region);
    const blocked = verdicts.filter((v) => v.decision !== 'publish').map((v) => v.region);
    const conflict = canPublish.length > 0 && blocked.length > 0;
    opts.board.setVerdicts(ctx.roomId, verdicts, conflict);

    await tools.sendEvent(
      `Verdicts: ${verdicts.map((v) => `${v.region}=${v.decision}`).join(', ')}.` +
        (conflict ? ` Cross-region conflict: ${canPublish.join('/')} can publish while ${blocked.join('/')} cannot.` : ''),
      'verdict',
    );

    // Tell the coordinator the outcome in plain English.
    const coordTarget = await resolveByHandle(tools, opts.coordinatorHandle, message);
    await tools.sendMessage(verdictSummary(verdicts, conflict, canPublish, blocked), [coordTarget]);

    // Route fixable regions to remediation. The findings live on the board, so the
    // message just asks for the adaptation.
    if (adaptRegions.length > 0 && opts.remediationHandle) {
      const remediation = await findParticipant(tools, opts.remediationHandle, 'agent');
      if (remediation) {
        opts.board.noteRemediation(ctx.roomId);
        await tools.sendEvent(`Requested remediation for ${adaptRegions.join('/')}.`, 'remediation');
        await tools.sendMessage(
          `@${remediation.handle}, please adapt the copy for ${adaptRegions.join(', ')} to fix the compliance gaps, then re-submit.`,
          [{ id: remediation.id, handle: remediation.handle }],
        );
      }
    }

    // Escalate unresolvable blocks to the human with a plain-language brief.
    if (escalateRegions.length > 0 && opts.humanHandle) {
      const human = await findParticipant(tools, opts.humanHandle, 'user');
      if (human) {
        const brief = escalateRegions
          .map((region) => {
            const blocks = (byRegion.get(region)?.findings ?? []).filter((f) => f.severity === 'block');
            const issues = blocks.length
              ? blocks.map((f) => f.rationale).join(' ')
              : verdicts.find((v) => v.region === region)?.rationale ?? 'Unresolved compliance issue.';
            return `In ${region}: ${issues}`;
          })
          .join('\n');
        const passing = verdicts.filter((v) => v.decision === 'publish').map((v) => v.region);
        const escalationMsg =
          `I need your call on this campaign before it can publish.\n\n${brief}\n\n` +
          (passing.length > 0 ? `It is clear to publish in ${passing.join(', ')}. ` : '') +
          `Automated remediation could not resolve ${escalateRegions.join('/')}. ` +
          `Your options: approve (publish as-is and accept the ${escalateRegions.join('/')} risk), ` +
          `reject (hold ${escalateRegions.join('/')}), or request changes (send it back to the team). What is your call?`;
        await tools.sendEvent(`Escalating ${escalateRegions.join('/')} to ${human.handle} for a human decision.`, 'escalation');
        await tools.sendMessage(escalationMsg, [{ id: human.id, handle: human.handle }]);
        pendingByRoom.set(ctx.roomId, escalateRegions);
        opts.board.escalate(ctx.roomId);
      } else {
        await tools.sendEvent(`Need to escalate ${escalateRegions.join('/')} but ${opts.humanHandle} is not in the room.`, 'escalation');
      }
    }

    // All clear: nothing to adapt or escalate.
    if (adaptRegions.length === 0 && escalateRegions.length === 0) {
      opts.board.complete(ctx.roomId);
    }
  };
}

/** Compose a plain-English verdict summary for the coordinator. */
function verdictSummary(
  verdicts: RegionVerdict[],
  conflict: boolean,
  canPublish: string[],
  blocked: string[],
): string {
  const phrase = (v: RegionVerdict): string => {
    if (v.region === 'BRAND') return v.decision === 'publish' ? 'on-brand' : 'off-brand';
    if (v.decision === 'publish') return 'publish';
    if (v.decision === 'adapt') return 'needs changes';
    return 'needs a human call';
  };
  const lines = verdicts.map((v) => `${v.region}: ${phrase(v)}`).join('. ');
  const tail = conflict ? ` ${canPublish.join('/')} can publish, but ${blocked.join('/')} cannot as-is.` : '';
  return `Verdicts are in. ${lines}.${tail}`;
}

function decideRegion(review: ReviewResult): RegionVerdict {
  const blocks = review.findings.filter((f) => f.severity === 'block');
  if (blocks.length === 0) {
    return { region: review.region, decision: 'publish', rationale: 'No blocking findings.' };
  }
  const fixable = (b: Finding): boolean =>
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
