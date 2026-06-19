import { useCallback, useEffect, useRef, useState } from 'react';
import { getCampaign, startCampaignReview, submitCampaignDecision, subscribeToCampaignEvents, type EventSubscription } from '../api';
import { Markdown } from '../pages/ArtifactViewerPage';
import type { BoardEvent } from '../types';

// Each agent's model on the AI/ML API multi-model cast, keyed by its display name, so
// the live roster + feed show what powers each agent (the multi-model AIML showcase).
const AGENT_MODEL: Record<string, string> = {
  Coordinator: 'Gemini 2.5 Flash',
  'US Reviewer': 'GPT-5',
  'EU Reviewer': 'Gemini 2.5 Pro',
  'LATAM Reviewer': 'Llama 3.3 70B',
  'Brand Reviewer': 'Claude Haiku 4.5',
  Reconcile: 'Claude Opus 4.5',
  Remediation: 'DeepSeek',
  'Claims Lead': 'GPT-5',
  'Reg Lead': 'Gemini 2.5 Pro',
  'Brand Lead': 'Claude Haiku 4.5',
  Scout: 'Llama 3.3 70B',
  'Claim & Evidence': 'Gemini 2.5 Pro',
  Disclosure: 'Claude Sonnet 4.5',
  Precedent: 'Gemini 2.5 Flash',
  'Risk Adjudicator': 'Claude Opus 4.5',
  Mediator: 'Claude Opus 4.5',
};

interface ReviewChatProps {
  campaignId: string;
  advertisementId?: string;
  campaignName: string;
  advertisementName?: string;
  /** Pre-scope to a material (skips the picker). Optional: normally the user picks. */
  materialId?: string;
  materialName?: string;
  /** Resume an already-running review (so closing/reopening the panel keeps progress). */
  reviewId?: string;
  /** Reports the review id (and the material label) back so it survives a close/reopen. */
  onReviewStarted?: (reviewId: string, label?: string) => void;
  /** Fired with the report's artifact id when the agents publish one, so the page can show it. */
  onReport?: (artifactId: string) => void;
  onClose: () => void;
}

/** Extract the artifact id from a report URL like `<base>/a/<id>`. */
function artifactIdFromUrl(url: string): string | null {
  const m = /\/a\/([^/?#]+)/.exec(url) ?? /\/api\/artifacts\/([^/?#]+)/.exec(url);
  return m ? (m[1] ?? null) : null;
}

type Phase = 'picking' | 'starting' | 'live' | 'awaiting' | 'done' | 'error';

interface PickMaterial {
  id: string;
  name: string;
  kind: string;
  imageUrl?: string;
}

interface FeedLine {
  key: string;
  from: string;
  text: string;
  tone: 'normal' | 'verdict' | 'final' | 'block';
  /** A report/artifact URL detected in the message; rendered as a button. */
  url?: string;
}

const URL_RE = /(https?:\/\/[^\s)]+)/i;

/** Pull a report link out of a line and strip the "Full report: <url>" tail from the text. */
function withReportLink(line: Omit<FeedLine, 'key'>): Omit<FeedLine, 'key'> {
  const m = URL_RE.exec(line.text);
  if (!m) return line;
  const url = m[1];
  const text = line.text.replace(/\s*(?:Full report:)?\s*https?:\/\/[^\s)]+/i, '').trim();
  return { ...line, text: text || line.text.replace(URL_RE, '').trim() || 'Review report ready.', url };
}

/** Turn a board event into a readable feed line (or null to skip noise). */
function lineFor(e: BoardEvent): Omit<FeedLine, 'key'> | null {
  const from = e.fromName ?? 'Agent';
  switch (e.type) {
    case 'intake':
      return { from: 'Intake', text: `Posted "${e.asset?.name ?? e.asset?.id ?? 'material'}" for review.`, tone: 'normal' };
    case 'recruited':
    case 'progress':
    case 'log':
    case 'escalation':
    case 'decision':
    case 'workitem':
    case 'debate':
    case 'pod-finding':
    case 'mediation':
    case 'adjudication':
      return e.text ? { from, text: e.text, tone: 'normal' } : null;
    case 'verdict':
      return {
        from,
        text: (e.verdicts ?? []).map((v) => `${v.region}: ${v.decision}`).join('  ·  ') || 'verdicts in',
        tone: 'verdict',
      };
    case 'terminal':
      return { from, text: `Final decision: ${e.decision}`, tone: e.decision === 'spiked' ? 'block' : 'final' };
    default:
      return null; // status / perceiving / review / revised: not shown as lines
  }
}

/**
 * Live review panel. The judge picks ONE material to analyze, then it runs the REAL
 * band.ai review of just that material (one room): the agents recruit, debate per
 * region, and reconcile, every step streaming in. No band.ai login: our server drives
 * the review and relays the agents' activity over SSE.
 */
export function ReviewChat({ campaignId, advertisementId, campaignName, advertisementName, materialId, materialName, reviewId, onReviewStarted, onReport, onClose }: ReviewChatProps) {
  const [phase, setPhase] = useState<Phase>(reviewId ? 'live' : materialId ? 'starting' : 'picking');
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<FeedLine[]>([]);
  const [rid, setRid] = useState<string | null>(reviewId ?? null);
  const [materials, setMaterials] = useState<PickMaterial[] | null>(null);
  const [pickedName, setPickedName] = useState<string | undefined>(materialName);
  // The material the user picked, kept so we can post a yes/no decision for it.
  const [activeMaterialId, setActiveMaterialId] = useState<string | undefined>(materialId);
  // The judge's verdict on the agents' recommendation.
  const [decisionState, setDecisionState] = useState<'idle' | 'sending' | 'approved' | 'rejected'>('idle');
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  // Stable ref so the subscribe effect can surface a report without re-subscribing.
  const onReportRef = useRef(onReport);
  onReportRef.current = onReport;

  // Run the real band.ai review for one chosen material.
  const startReview = useCallback(
    async (mid: string, mname: string) => {
      setPickedName(mname);
      setPhase('starting');
      setError(null);
      try {
        const res = await startCampaignReview(campaignId, advertisementId, mid);
        setRid(res.id);
        setActiveMaterialId(mid);
        onReviewStarted?.(res.id, mname);
        setPhase('live');
      } catch (err) {
        setPhase('error');
        setError(err instanceof Error ? err.message : 'Could not start the review.');
      }
    },
    [campaignId, advertisementId, onReviewStarted],
  );

  // The judge rules on the agents' recommendation. The decision text is posted back
  // into the room to the adjudicator (yes = ship, reject = spike); the live stream
  // then reflects the new verdict, so no manual refetch is needed.
  const decide = useCallback(
    async (verdict: 'yes' | 'reject') => {
      if (!rid || !activeMaterialId) return;
      setDecisionState('sending');
      setDecisionError(null);
      try {
        await submitCampaignDecision(rid, activeMaterialId, verdict);
        setDecisionState(verdict === 'yes' ? 'approved' : 'rejected');
      } catch {
        setDecisionState('idle');
        setDecisionError('Could not send your decision — this review may have ended. Start a fresh review.');
      }
    },
    [rid, activeMaterialId],
  );

  // On open: resume an existing review, auto-start a pre-scoped material, or load the
  // advertisement's materials so the judge can pick one.
  useEffect(() => {
    let cancelled = false;
    // Always load the materials (id/name/kind/image), even when resuming or pre-scoped,
    // so both the picker AND the "material under review" thumbnail have what they need.
    (async () => {
      try {
        const { campaign } = await getCampaign(campaignId);
        if (cancelled) return;
        const ads = advertisementId ? campaign.advertisements.filter((a) => a.id === advertisementId) : campaign.advertisements;
        setMaterials(ads.flatMap((a) => a.materials).map((m) => ({ id: m.id, name: m.name ?? m.id, kind: m.kind, ...(m.imageUrl ? { imageUrl: m.imageUrl } : {}) })));
      } catch (err) {
        if (cancelled) return;
        if (!reviewId && !materialId) setError(err instanceof Error ? err.message : 'Could not load the materials.');
        setMaterials([]);
      }
    })();
    // Resume is handled by the subscribe effect; a pre-scoped material auto-starts.
    if (!reviewId && materialId) void startReview(materialId, materialName ?? materialId);
    return () => { cancelled = true; };
  }, [campaignId, advertisementId, materialId, materialName, reviewId, startReview]);

  // Subscribe to the review's live event stream.
  useEffect(() => {
    if (!rid) return;
    let sub: EventSubscription | null = subscribeToCampaignEvents(rid, (e) => {
      const mid = (e as { materialId?: string }).materialId;
      // Status events reuse seq 0 (escalation emits awaiting-decision, then a ruling
      // emits complete), so fold the status value into the key or the second one is
      // dropped as a duplicate and the panel never flips to done.
      const statusTag = e.type === 'status' ? `:${(e as { status?: string }).status ?? ''}` : '';
      const key = `${mid ?? ''}:${e.seq}:${e.type}${statusTag}`;
      if (seen.current.has(key)) return;
      seen.current.add(key);
      // Capture the material id from the stream so a resumed review (no materialId
      // prop, never calls startReview) can still post a decision for the right one.
      if (mid) setActiveMaterialId((prev) => prev ?? mid);
      if (e.type === 'status') {
        if (e.status === 'error') { setPhase('error'); return; }
        if (e.status === 'complete') { setPhase('done'); return; }
        // Escalation parks the review here until the human rules yes/reject.
        if (e.status === 'awaiting-decision') { setPhase('awaiting'); return; }
        return; // other statuses are not rendered as feed lines
      }
      // Band mode (real band.ai rooms) signals the human decision via an `escalation`
      // event rather than the local path's awaiting-decision status; surface the
      // Approve/Reject buttons either way. The ruling posts back into the room.
      if (e.type === 'escalation') setPhase('awaiting');
      const ln = lineFor(e);
      if (ln) {
        const withLink = withReportLink(ln);
        setLines((prev) => [...prev, { ...withLink, key }]);
        // Do NOT auto-open the report here: the user opens it from the "Open full
        // report" button so the pop-up never interrupts the live chat.
      }
    });
    return () => { sub?.close(); sub = null; };
  }, [rid]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [lines]);

  const scope = pickedName ?? (advertisementName ? `${campaignName} · ${advertisementName}` : campaignName);
  const statusText =
    phase === 'picking' ? 'Pick a material to analyze' :
    phase === 'starting' ? 'Starting the review…' :
    phase === 'error' ? 'Review error' :
    phase === 'awaiting' ? 'Awaiting your decision' :
    phase === 'done' ? 'Review complete' : 'Agents reviewing live';

  // The distinct agents that have spoken so far, shown as a live "who's collaborating" roster.
  const activeAgents = [...new Set(lines.map((l) => l.from))].filter((a) => a && a !== 'system');
  const pickedImage = materials?.find((m) => m.id === activeMaterialId)?.imageUrl;

  return (
    <aside className="surface flex max-h-[calc(100vh-7rem)] w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface">
        <header className="glass flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="eyebrow text-accent/80">Review · live with the agents</p>
            <h2 className="truncate font-display text-xl text-fg">{phase === 'picking' ? (advertisementName ?? campaignName) : scope}</h2>
            <p className="mt-0.5 inline-flex items-center gap-1.5 font-mono text-[11px] text-faint">
              {phase === 'live' || phase === 'starting' ? <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent" /> : null}
              {statusText} · on band.ai
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost shrink-0 px-2.5 py-1 text-xs">Close</button>
        </header>

        {pickedImage ? (
          <div className="border-b border-border bg-bg-soft/30 px-5 py-3">
            <img src={pickedImage} alt={scope} className="mx-auto max-h-44 w-auto rounded-lg border border-border" />
          </div>
        ) : null}

        {activeAgents.length > 0 ? (
          <div className="border-b border-border px-5 py-2.5">
            <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-faint">Agents collaborating <span className="text-violet-300/70">· each on its AI/ML API model</span></p>
            <div className="flex flex-wrap gap-1.5">
              {activeAgents.map((a) => (
                <span key={a} className="inline-flex items-center gap-1 rounded-full border border-violet-400/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-200">
                  {a}
                  {AGENT_MODEL[a] ? <span className="text-violet-300/55">· {AGENT_MODEL[a]}</span> : null}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-5">
          {phase === 'picking' ? (
            <div className="space-y-2">
              <p className="text-sm text-muted">Choose which material the agents should review. Each runs as one band.ai room.</p>
              {materials === null ? (
                <p className="text-xs text-faint">Loading materials…</p>
              ) : materials.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border-strong bg-surface/40 px-4 py-6 text-center text-sm text-muted">No materials to review here.</p>
              ) : (
                materials.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => startReview(m.id, m.name)}
                    className="surface flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:border-accent/40 hover:bg-accent/[0.04]"
                  >
                    <span className="truncate text-sm font-medium text-fg">{m.name}</span>
                    <span className="shrink-0 rounded-full bg-bg-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-faint">{m.kind}</span>
                  </button>
                ))
              )}
              {error ? <p className="text-xs text-danger">{error}</p> : null}
            </div>
          ) : (
            <>
              {phase === 'starting' ? (
                <p className="text-xs text-muted">Opening the band.ai room and recruiting the reviewer agents…</p>
              ) : null}
              {phase === 'error' ? (
                <div className="rounded-xl border border-danger/30 bg-danger/[0.06] p-3 text-sm text-danger">{error ?? 'The review hit an error.'}</div>
              ) : null}

              {lines.map((ln) => (
                <div
                  key={ln.key}
                  className={[
                    'rounded-xl px-3.5 py-2 text-sm leading-relaxed',
                    ln.tone === 'final' ? 'border border-human/30 bg-human/[0.08] text-fg' :
                    ln.tone === 'block' ? 'border border-danger/30 bg-danger/[0.07] text-fg' :
                    ln.tone === 'verdict' ? 'border border-accent/30 bg-accent/[0.07] text-fg' :
                    'surface text-fg/90',
                  ].join(' ')}
                >
                  <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-violet-300/80">{ln.from}{AGENT_MODEL[ln.from] ? <span className="ml-1.5 font-normal normal-case text-violet-300/50">· {AGENT_MODEL[ln.from]}</span> : null}</p>
                  {/* Reuse the report renderer so ![campaign image](url) becomes a real <img>, not raw text. */}
                  <div className="text-sm leading-relaxed [&_h1]:text-current [&_h2]:text-current [&_h3]:text-current [&_li]:text-current [&_p:first-child]:mt-0 [&_p]:my-1 [&_p]:text-current">
                    <Markdown source={ln.text} />
                  </div>
                  {ln.url ? (
                    <button
                      type="button"
                      onClick={() => { const aid = artifactIdFromUrl(ln.url!); if (aid) onReportRef.current?.(aid); }}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/15"
                    >
                      Open full report
                    </button>
                  ) : null}
                </div>
              ))}

              {phase === 'live' && lines.length === 0 ? (
                <p className="inline-flex items-center gap-1.5 text-xs text-muted">
                  <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-violet-400" />
                  Waiting for the agents to weigh in…
                </p>
              ) : null}
              {phase === 'done' ? <p className="pt-1 text-xs text-faint">The agents have finished. The verdict is recorded on the material.</p> : null}
            </>
          )}
        </div>

        {/* The judge's call on an escalated verdict, posted back to the room. Shows when
            the review parks on a human decision, and stays to confirm after a ruling. */}
        {(phase === 'awaiting' || phase === 'done' || decisionState !== 'idle') && rid && activeMaterialId ? (
          <div className="border-t border-border px-5 py-4">
            {decisionState === 'approved' ? (
              <p className="text-sm font-medium text-human">You approved the agents' verdict. Shipping. ✓</p>
            ) : decisionState === 'rejected' ? (
              <p className="text-sm font-medium text-danger">You rejected the agents' verdict. Spiked. ✗</p>
            ) : (
              <>
                <p className="mb-2 text-xs text-muted">Your call on the agents' verdict:</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => decide('yes')}
                    disabled={decisionState === 'sending'}
                    className="btn flex-1 border border-human/40 bg-human/10 px-3 py-2 text-human hover:bg-human/15 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => decide('reject')}
                    disabled={decisionState === 'sending'}
                    className="btn flex-1 border border-danger/40 bg-danger/10 px-3 py-2 text-danger hover:bg-danger/15 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
                {decisionState === 'sending' ? <p className="mt-2 text-[11px] text-faint">Sending your decision to the agents…</p> : null}
                {decisionError ? <p className="mt-2 text-[11px] text-danger">{decisionError}</p> : null}
              </>
            )}
          </div>
        ) : null}
      </aside>
  );
}
