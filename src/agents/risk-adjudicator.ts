// src/agents/risk-adjudicator.ts
import type { AgentHandler, RoomTools } from '../band/types';
import type { Finding } from '../domain/types';
import type { PodFinding, ConflictItem, MediationResult } from '../domain/board';
import type { PodHub } from '../board/pod-hub';
import type { NewArtifact } from '../domain/artifact';
import { matchParticipant } from './handles';
import { composeReport, type ReportSource, type ReportFix, type ReportDecision } from './review-report';

export interface RiskAdjudicatorOptions {
  expectedPods: Array<'claims' | 'regulatory' | 'brand'>;
  mediatorHandle: string;     // '@mediator'
  remediationHandle: string;  // '@remediation'
  humanHandle: string;        // '@compliance-lead'
  maxRecommits?: number;      // default 1
  logPrecedent?: (p: { claim: string; decision: string; note: string }) => void;
  hub?: PodHub;               // when set, read pod findings/mediation from the hub (prose on the wire)
  /** Publish the report as an artifact and get back a viewer URL to link in the room. */
  publishArtifact?: (input: NewArtifact) => { id: string; url: string } | Promise<{ id: string; url: string }>;
}

interface RoomState {
  pods: Map<string, PodFinding>;
  mediation?: MediationResult;
  recommits: number;
  mediateRequested: boolean;
  /** True once we have surfaced the blocks to the human and asked to fix them. */
  permissionAsked: boolean;
  /** The per-reviewer findings captured when we first asked, so the FINAL report can
   *  still show what was wrong after a fix has cleared the re-review. */
  snapshot?: ReportSource[];
  /** True when the pending fix is a per-market split (markets collide irreconcilably),
   *  so the human's "yes" produces tailored versions instead of one shared rewrite. */
  pendingSplit?: boolean;
}

// Friendly reviewer labels for the report (hub keys -> human-facing source names).
const SOURCE_LABEL: Record<string, string> = { claims: 'Claims', brand: 'Brand', US: 'US', EU: 'EU', LATAM: 'LATAM' };

// The human authorizes a fix vs rules against the campaign. Reject wins on a tie
// (so "no, reject" never accidentally triggers a rewrite). "no" only counts as a
// rejection when it leads the message, so "no problem, go ahead" still approves.
const REJECT = /\b(reject|spike|kill|deny|decline|do not|don'?t|cannot|can'?t|no way)\b/i;
const REJECT_LEAD = /^\s*(no|nope|nah)\b/i;
const APPROVE = /\b(yes|yeah|yep|approve|approved|fix|remediate|go ahead|proceed|do it|ok|okay|sure|please)\b/i;
const isReject = (t: string): boolean => REJECT.test(t) || REJECT_LEAD.test(t);
const isApprove = (t: string): boolean => APPROVE.test(t) && !isReject(t);

export function makeRiskAdjudicator(opts: RiskAdjudicatorOptions): AgentHandler {
  const max = opts.maxRecommits ?? 1;
  const rooms = new Map<string, RoomState>();
  const stateFor = (id: string): RoomState => {
    let s = rooms.get(id);
    if (!s) { s = { pods: new Map(), recommits: 0, mediateRequested: false, permissionAsked: false }; rooms.set(id, s); }
    return s;
  };
  const conflictsOf = (s: RoomState): ConflictItem[] => [...s.pods.values()].flatMap((p) => p.conflicts ?? []);

  // Every blocking finding across the pods, deduped by claim span. A solo pod
  // (Claims, Brand) files blocks with no cross-pod conflict, so a block is the most
  // reliable "this cannot ship as-is" signal: the gate keys off blocks, not only
  // conflicts, so a solo block is never silently published.
  const blocksOf = (s: RoomState): Finding[] => {
    const seen = new Set<string>();
    const out: Finding[] = [];
    for (const p of s.pods.values()) {
      for (const f of p.findings ?? []) {
        if (f.severity !== 'block') continue;
        const k = f.claim.trim().toLowerCase();
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(f);
      }
    }
    return out;
  };

  // Per-reviewer findings for the report: granular from the hub (Claims/Brand/US/EU/
  // LATAM each with their rules), or the consolidated pod findings without a hub.
  const sourcesFor = (roomId: string): ReportSource[] => {
    const s = stateFor(roomId);
    if (opts.hub) {
      return ['claims', 'US', 'EU', 'LATAM', 'brand']
        .map((k) => ({ source: SOURCE_LABEL[k] ?? k, findings: opts.hub!.finding(roomId, k) }))
        .filter((x) => x.findings.length > 0);
    }
    return [...s.pods.entries()]
      .map(([pod, pf]) => ({ source: SOURCE_LABEL[pod] ?? pod, findings: pf.findings ?? [] }))
      .filter((x) => x.findings.length > 0);
  };

  // The proposed rewrite(s) to show in the report: the revised asset from the hub.
  const fixesFor = (roomId: string): ReportFix[] | undefined => {
    const rev = opts.hub?.revised(roomId);
    if (!rev) return undefined;
    return [{ region: (rev.markets?.length ? rev.markets : ['all']).join('/'), copy: rev.copy, ...(rev.imageUrl ? { imageUrl: rev.imageUrl } : {}) }];
  };

  // The one self-contained report message: the verdict, every flagged claim (by
  // reviewer, rule, and reason), the proposed fixes, and material links. Posted as
  // the permission ask AND as the final word, so the verdict is never buried.
  const postReport = async (roomId: string, tools: RoomTools, decision: ReportDecision, fixesOverride?: ReportFix[]): Promise<void> => {
    const s = stateFor(roomId);
    const asset = opts.hub?.asset(roomId);
    const sources = s.snapshot ?? sourcesFor(roomId);
    const fixes = fixesOverride ?? fixesFor(roomId);
    const report = composeReport({
      asset: { id: asset?.id ?? 'asset', ...(asset?.name ? { name: asset.name } : {}), ...(asset?.markets ? { markets: asset.markets } : {}), ...(asset?.imageUrl ? { imageUrl: asset.imageUrl } : {}) },
      sources,
      decision,
      ...(fixes ? { fixes } : {}),
    });
    const tail = decision === 'asking'
      ? (s.pendingSplit
          ? '\n\nThese markets cannot share one compliant version. Reply "yes" to ship market-tailored versions (one per market), or "reject" to spike the campaign.'
          : '\n\nReply "yes" to fix the blocked claims and regenerate the promo image, or "reject" to spike the campaign.')
      : '';
    // Publish the report as an artifact and lead with the viewer link, so band.ai
    // carries a clickable link to the full, rendered report in the dashboard.
    let head = '';
    if (opts.publishArtifact) {
      try {
        const { url } = await opts.publishArtifact({ kind: 'markdown', title: `Review report: ${asset?.name ?? asset?.id ?? 'campaign'} (${decision})`, content: report, createdBy: 'Risk Adjudicator' });
        head = `Full report (rendered, with images): ${url}\n\n`;
      } catch { /* fall back to the inline report if publishing fails */ }
    }
    const human = matchParticipant(await tools.getParticipants(), opts.humanHandle, 'user');
    await tools.sendMessage(head + report + tail, human ? [{ id: human.id, handle: human.handle }] : []);
  };

  // Stash every problem as a conflict-shaped item on the hub so Remediation can
  // rewrite all of them at once (it reads hub.conflicts). Blocks already covered by
  // a cross-pod conflict are not duplicated.
  const stashForRemediation = (roomId: string, blocks: Finding[], conflicts: ConflictItem[], markets: string[]): void => {
    const conflictSpans = new Set(conflicts.map((c) => c.span));
    const items: ConflictItem[] = [
      ...conflicts,
      ...blocks
        .filter((b) => !conflictSpans.has(b.claim))
        .map((b) => ({ span: b.claim, blockedBy: markets.length ? markets : ['all'], passedBy: [], rationale: b.rationale })),
    ];
    opts.hub?.setConflicts(roomId, items);
  };

  // The human said yes: send the blocked spans to Remediation and reset the pod
  // accumulation so the recommit re-review starts clean.
  const triggerRemediation = async (roomId: string, tools: RoomTools): Promise<void> => {
    const s = stateFor(roomId);
    s.recommits += 1;
    const blocks = blocksOf(s);
    const conflicts = conflictsOf(s);
    const asset = opts.hub?.asset(roomId);
    stashForRemediation(roomId, blocks, conflicts, asset?.markets ?? []);
    await tools.sendEvent(`Adjudicator: remediating (attempt ${s.recommits})`, 'adjudication', { decision: 'remediate', score: 0.5 });
    const t = matchParticipant(await tools.getParticipants(), opts.remediationHandle, 'agent');
    if (t) {
      const region = conflicts[0]?.blockedBy[0] ?? asset?.markets?.[0] ?? 'EU';
      const msg = opts.hub
        ? `Remediation, the compliance lead approved a fix. Rewrite the blocked copy, regenerate the promo image, and re-submit.`
        : JSON.stringify({ kind: 'remediation', region, findings: [...conflicts.map((c) => ({ category: 'claim', severity: 'block', claim: c.span, rationale: c.rationale })), ...blocks.map((b) => ({ category: b.category, severity: 'block', claim: b.claim, rationale: b.rationale }))] });
      await tools.sendMessage(msg, [{ id: t.id, handle: t.handle }]);
    }
    s.pods.clear(); s.mediation = undefined; s.mediateRequested = false;
  };

  // Cross-market collisions: a span one market bans and another allows, unresolved
  // by the Mediator. These are the spans that force a per-market split.
  const crossMarketOf = (s: RoomState): ConflictItem[] =>
    (s.mediation?.resolved ? [] : conflictsOf(s)).filter((c) => c.blockedBy.length > 0 && c.passedBy.length > 0);

  // One tailored-rewrite plan per market that has anything to fix: its own banned
  // spans plus the universal blocks (which apply to every market's version). A
  // market with nothing to fix is omitted (it ships the original).
  const buildSplitPlan = (s: RoomState, markets: string[]): { region: string; findings: Finding[] }[] => {
    const cross = crossMarketOf(s);
    const conflictSpans = new Set(conflictsOf(s).map((c) => c.span));
    const sharedBlocks = blocksOf(s).filter((b) => !conflictSpans.has(b.claim));
    const all = markets.length ? markets : [...new Set(cross.flatMap((c) => [...c.blockedBy, ...c.passedBy]))];
    return all
      .map((region) => ({
        region,
        findings: [
          ...cross.filter((c) => c.blockedBy.includes(region)).map((c) => ({ category: 'claim', severity: 'block' as const, claim: c.span, rationale: c.rationale })),
          ...sharedBlocks,
        ],
      }))
      .filter((p) => p.findings.length > 0);
  };

  // The human approved a split: hand Remediation the per-market plan. The per-market
  // terminal is emitted when Remediation reports the versions back.
  const triggerSplit = async (roomId: string, tools: RoomTools): Promise<void> => {
    const s = stateFor(roomId);
    s.recommits += 1;
    const asset = opts.hub?.asset(roomId);
    const plan = buildSplitPlan(s, asset?.markets ?? []);
    opts.hub?.setSplitPlan(roomId, plan);
    await tools.sendEvent(`Adjudicator: producing ${plan.length} market-tailored version(s)`, 'adjudication', { decision: 'remediate', score: 0.5 });
    const t = matchParticipant(await tools.getParticipants(), opts.remediationHandle, 'agent');
    if (t) await tools.sendMessage(`Remediation, the compliance lead approved per-market versions. Produce a tailored version for: ${plan.map((p) => p.region).join(', ')}.`, [{ id: t.id, handle: t.handle }]);
  };

  // Finalize a split: publish EVERY market, blocking markets with their tailored
  // version and passing markets with the original, then post the final report.
  const finalizeSplit = async (roomId: string, tools: RoomTools): Promise<void> => {
    const s = stateFor(roomId);
    const versions = opts.hub?.splitVersions(roomId) ?? [];
    const asset = opts.hub?.asset(roomId);
    if (!s.snapshot) s.snapshot = sourcesFor(roomId);
    const byRegion = new Map(versions.map((v) => [v.region, v]));
    const markets = asset?.markets?.length ? asset.markets : versions.map((v) => v.region);
    const fixes: ReportFix[] = markets.map((region) => {
      const v = byRegion.get(region);
      return v ? { region, copy: v.copy, ...(v.imageUrl ? { imageUrl: v.imageUrl } : {}) } : { region, copy: asset?.copy ?? '(original copy)' };
    });
    for (const region of markets) {
      await tools.sendEvent(`${region}: published (${byRegion.has(region) ? 'market-tailored' : 'original, no change needed'})`, 'adjudication', { decision: 'publish', score: 1 });
    }
    await postReport(roomId, tools, 'published', fixes);
    await tools.sendEvent(`Published ${markets.length} market version(s)`, 'terminal', { decision: 'published' });
    await tools.sendEvent('done', 'status', { status: 'complete' });
    opts.hub?.setSplitVersions(roomId, undefined);
    rooms.delete(roomId);
  };

  const decide = async (roomId: string, tools: RoomTools): Promise<void> => {
    const s = stateFor(roomId);
    const conflicts = conflictsOf(s);

    // 1) Cross-pod conflicts go to the Mediator first (the negotiation showcase).
    if (conflicts.length > 0 && !s.mediateRequested) {
      s.mediateRequested = true;
      const t = matchParticipant(await tools.getParticipants(), opts.mediatorHandle, 'agent');
      await tools.sendEvent(`Adjudicator: ${conflicts.length} conflict(s), consulting mediator`, 'adjudication', { decision: 'mediate' });
      opts.hub?.setConflicts(roomId, conflicts);
      if (t) await tools.sendMessage(opts.hub ? `${conflicts.length} cross-pod conflict(s). Mediator, can these be resolved?` : JSON.stringify({ kind: 'mediate', conflicts }), [{ id: t.id, handle: t.handle }]);
      return;
    }

    // 2) After mediation, what is still wrong = hard blocks + unresolved conflicts.
    const mediationResolved = s.mediation?.resolved ?? false;
    const unresolvedConflicts = conflicts.length > 0 && !mediationResolved ? conflicts : [];
    const conflictSpans = new Set(conflicts.map((c) => c.span));
    const blocks = blocksOf(s).filter((b) => !conflictSpans.has(b.claim));
    const problems = blocks.length + unresolvedConflicts.length;

    // 3) Nothing blocking -> publish, with a full report (what was checked, any fix).
    if (problems === 0) {
      const total = [...s.pods.values()].reduce((n, p) => n + (p.findings?.length ?? 0), 0);
      await tools.sendEvent(`Adjudicator: reviewed ${[...s.pods.keys()].join(', ') || 'all'} pods, ${total} finding(s), none blocking. Publishable.`, 'adjudication', { decision: 'publish', score: 1 });
      await postReport(roomId, tools, 'published');
      await tools.sendEvent('PUBLISHED', 'terminal', { decision: 'published' });
      await tools.sendEvent('done', 'status', { status: 'complete' });
      rooms.delete(roomId);
      return;
    }

    // 4) We already spent our one fix and it still blocks -> escalate to the human
    //    with the full report for a final ruling.
    if (s.permissionAsked && s.recommits >= max) {
      const first = blocks[0]?.claim ?? unresolvedConflicts[0]?.span ?? 'the campaign';
      await tools.sendEvent('Adjudicator: deadlock after remediation, escalating', 'adjudication', { decision: 'escalate', score: 0.1 });
      await tools.sendEvent(`Escalation: still blocked on "${first}" after a rewrite`, 'escalation', {});
      await tools.sendEvent('awaiting human', 'status', { status: 'awaiting-decision' });
      await postReport(roomId, tools, 'escalated');
      return;
    }

    // 5) First time we have something blocking: capture the snapshot and post the full
    //    report as the permission ask. The fix does not run until the human says yes.
    if (!s.permissionAsked) {
      s.permissionAsked = true;
      s.snapshot = sourcesFor(roomId);
      // Markets that ban a span others allow cannot share one version -> propose a split.
      s.pendingSplit = crossMarketOf(s).length > 0;
      const mode = s.pendingSplit ? 'per-market versions' : 'a fix';
      await tools.sendEvent(`Adjudicator: ${blocks.length} block(s)${unresolvedConflicts.length ? `, ${unresolvedConflicts.length} unresolved conflict(s)` : ''}; asking the compliance lead to approve ${mode}`, 'adjudication', { decision: 'remediate', score: 0.4 });
      await tools.sendEvent('awaiting human', 'status', { status: 'awaiting-decision' });
      // Keep an 'escalation' event for the dashboard timeline; the full detail is the
      // report message below.
      await tools.sendEvent(`${blocks.length + unresolvedConflicts.length} issue(s) need a ruling`, 'escalation', {});
      await postReport(roomId, tools, 'asking');
      return;
    }
  };

  return async (message, tools) => {
    const roomId = message.roomId;
    const s = stateFor(roomId);
    let body: Record<string, unknown> | null = null;
    try { body = JSON.parse(message.content); } catch { body = null; }

    // Human input: plain text from the compliance lead. It is either the approval at
    // the permission gate, or a terminal ruling.
    if (message.senderType === 'user' && !body) {
      const text = message.content;

      // Permission gate: the human authorizes the fix -> run it now. A market collision
      // produces per-market versions; everything else is one shared rewrite.
      if (s.permissionAsked && s.recommits < max && !isReject(text) && isApprove(text)) {
        await tools.sendEvent('Compliance lead approved the fix', 'decision', { decision: 'remediate' });
        if (s.pendingSplit) await triggerSplit(roomId, tools);
        else await triggerRemediation(roomId, tools);
        return;
      }
      // An ambiguous reply at the gate (neither approve nor reject): re-prompt, do not
      // act destructively.
      if (s.permissionAsked && s.recommits < max && !isReject(text)) {
        await tools.sendEvent('Adjudicator: awaiting a yes/reject', 'status', { status: 'awaiting-decision' });
        const t = matchParticipant(await tools.getParticipants(), opts.humanHandle, 'user');
        if (t) await tools.sendMessage('@compliance-lead reply "yes" to fix the blocked claims, or "reject" to spike the campaign.', [{ id: t.id, handle: t.handle }]);
        return;
      }

      // Terminal ruling: reject -> spiked, anything else -> published. Post the FINAL report.
      const reject = isReject(text);
      const decision = reject ? 'spiked' : 'published';
      opts.logPrecedent?.({ claim: conflictsOf(s)[0]?.span ?? blocksOf(s)[0]?.claim ?? '', decision, note: text });
      await tools.sendEvent(`Human ruling: ${decision}`, 'decision', { decision });
      await postReport(roomId, tools, decision);
      await tools.sendEvent(decision === 'spiked' ? 'SPIKED' : 'PUBLISHED', 'terminal', { decision });
      await tools.sendEvent('done', 'status', { status: 'complete' });
      rooms.delete(roomId);
      return;
    }

    // Remediation reported the per-market versions back -> publish each one and post
    // the final report. (On a single-fix recommit, Remediation reports to the
    // Conductor instead, so the Adjudicator only lands here for a split.)
    if (opts.hub && message.senderType === 'agent' && (message.senderName ?? '').toLowerCase().includes('remediat') && (opts.hub.splitVersions(roomId)?.length ?? 0) > 0) {
      await finalizeSplit(roomId, tools);
      return;
    }

    // A pod filed its finding: JSON (back-compat) or prose from a lead (read the hub).
    let pod = body?.kind === 'pod-finding' ? String(body.pod) : '';
    let pf: PodFinding | undefined = body?.kind === 'pod-finding' ? (body as unknown as PodFinding) : undefined;
    if (!pf && opts.hub && message.senderType === 'agent') {
      const sn = (message.senderName ?? '').toLowerCase();
      const resolved = sn.includes('claim') ? 'claims' : sn.includes('reg') ? 'regulatory' : sn.includes('brand') ? 'brand' : '';
      if (resolved) { pf = opts.hub.podFinding(roomId, resolved); pod = resolved; }
    }
    if (pf) {
      s.pods.set(pod, pf);
      if (opts.expectedPods.every((p) => s.pods.has(p))) await decide(roomId, tools);
      return;
    }

    // The mediator reported back: JSON or prose (read the hub).
    let mediation: MediationResult | undefined = body?.kind === 'mediation' ? (body as unknown as MediationResult) : undefined;
    if (!mediation && opts.hub && (message.senderName ?? '').toLowerCase().includes('mediator')) mediation = opts.hub.mediation(roomId);
    if (mediation) {
      s.mediation = mediation;
      await decide(roomId, tools);
    }
  };
}
