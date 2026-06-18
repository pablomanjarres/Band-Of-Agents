import { useEffect, useRef, useState } from 'react';
import { startCampaignReview, subscribeToCampaignEvents, type EventSubscription } from '../api';
import type { BoardEvent } from '../types';

interface ReviewChatProps {
  campaignId: string;
  advertisementId?: string;
  campaignName: string;
  advertisementName?: string;
  /** Resume an already-running review (so closing/reopening the panel keeps progress). */
  reviewId?: string;
  /** Reports the review id back to the page so it survives a close/reopen. */
  onReviewStarted?: (reviewId: string) => void;
  onClose: () => void;
}

type Phase = 'starting' | 'live' | 'done' | 'error';

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
 * Live review panel: a judge opens this on a campaign/advertisement and it runs the
 * REAL band.ai review (the agents recruit, debate per region, and reconcile), with
 * every step streaming in. No band.ai login: our server drives the review and relays
 * the agents' activity over SSE.
 */
export function ReviewChat({ campaignId, advertisementId, campaignName, advertisementName, reviewId, onReviewStarted, onClose }: ReviewChatProps) {
  const [phase, setPhase] = useState<Phase>(reviewId ? 'live' : 'starting');
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<FeedLine[]>([]);
  const [rid, setRid] = useState<string | null>(reviewId ?? null);
  const seen = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  // Start the review once (unless resuming an existing one).
  useEffect(() => {
    if (reviewId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await startCampaignReview(campaignId, advertisementId);
        if (cancelled) return;
        setRid(res.id);
        onReviewStarted?.(res.id);
        setPhase('live');
      } catch (err) {
        if (cancelled) return;
        setPhase('error');
        setError(err instanceof Error ? err.message : 'Could not start the review.');
      }
    })();
    return () => { cancelled = true; };
  }, [campaignId, advertisementId, reviewId]);

  // Subscribe to the review's live event stream.
  useEffect(() => {
    if (!rid) return;
    let sub: EventSubscription | null = subscribeToCampaignEvents(rid, (e) => {
      const key = `${(e as { materialId?: string }).materialId ?? ''}:${e.seq}:${e.type}`;
      if (seen.current.has(key)) return;
      seen.current.add(key);
      if (e.type === 'status' && (e.status === 'complete' || e.status === 'error')) {
        setPhase(e.status === 'error' ? 'error' : 'done');
        return;
      }
      const ln = lineFor(e);
      if (ln) setLines((prev) => [...prev, { ...withReportLink(ln), key }]);
    });
    return () => { sub?.close(); sub = null; };
  }, [rid]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [lines]);

  const scope = advertisementName ? `${campaignName} · ${advertisementName}` : campaignName;
  const statusText =
    phase === 'starting' ? 'Starting the review…' : phase === 'error' ? 'Review error' : phase === 'done' ? 'Review complete' : 'Agents reviewing live';

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-bg/60 backdrop-blur-sm" />
      <aside className="relative z-10 flex h-full w-full max-w-xl flex-col border-l border-border bg-surface shadow-2xl">
        <header className="glass sticky top-0 flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="eyebrow text-accent/80">Review · live with the agents</p>
            <h2 className="truncate font-display text-xl text-fg">{scope}</h2>
            <p className="mt-0.5 inline-flex items-center gap-1.5 font-mono text-[11px] text-faint">
              {phase === 'live' || phase === 'starting' ? <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent" /> : null}
              {statusText} · on band.ai
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost shrink-0 px-2.5 py-1 text-xs">Close</button>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-5 py-5">
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
              <span className="mr-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-violet-300/80">{ln.from}</span>
              <span className="whitespace-pre-wrap">{ln.text}</span>
              {ln.url ? (
                <a
                  href={ln.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/15"
                >
                  View full report ↗
                </a>
              ) : null}
            </div>
          ))}

          {phase === 'live' && lines.length === 0 ? (
            <p className="inline-flex items-center gap-1.5 text-xs text-muted">
              <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-violet-400" />
              Waiting for the agents to weigh in…
            </p>
          ) : null}
          {phase === 'done' ? <p className="pt-1 text-xs text-faint">The agents have finished. Verdicts are recorded on the materials.</p> : null}
        </div>
      </aside>
    </div>
  );
}
