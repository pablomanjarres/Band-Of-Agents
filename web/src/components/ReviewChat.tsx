import { useCallback, useEffect, useRef, useState } from 'react';
import { getCampaign, startCampaignReview, subscribeToCampaignEvents, type EventSubscription } from '../api';
import type { BoardEvent } from '../types';

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
  /** Reports the review id back to the page so it survives a close/reopen. */
  onReviewStarted?: (reviewId: string) => void;
  /** Fired with the report's artifact id when the agents publish one, so the page can show it. */
  onReport?: (artifactId: string) => void;
  onClose: () => void;
}

/** Extract the artifact id from a report URL like `<base>/a/<id>`. */
function artifactIdFromUrl(url: string): string | null {
  const m = /\/a\/([^/?#]+)/.exec(url) ?? /\/api\/artifacts\/([^/?#]+)/.exec(url);
  return m ? (m[1] ?? null) : null;
}

type Phase = 'picking' | 'starting' | 'live' | 'done' | 'error';

interface PickMaterial {
  id: string;
  name: string;
  kind: string;
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
        onReviewStarted?.(res.id);
        setPhase('live');
      } catch (err) {
        setPhase('error');
        setError(err instanceof Error ? err.message : 'Could not start the review.');
      }
    },
    [campaignId, advertisementId, onReviewStarted],
  );

  // On open: resume an existing review, auto-start a pre-scoped material, or load the
  // advertisement's materials so the judge can pick one.
  useEffect(() => {
    if (reviewId) return; // resuming: the subscribe effect picks it up
    if (materialId) { void startReview(materialId, materialName ?? materialId); return; }
    let cancelled = false;
    (async () => {
      try {
        const { campaign } = await getCampaign(campaignId);
        if (cancelled) return;
        const ads = advertisementId ? campaign.advertisements.filter((a) => a.id === advertisementId) : campaign.advertisements;
        setMaterials(ads.flatMap((a) => a.materials).map((m) => ({ id: m.id, name: m.name ?? m.id, kind: m.kind })));
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load the materials.');
        setMaterials([]);
      }
    })();
    return () => { cancelled = true; };
  }, [campaignId, advertisementId, materialId, materialName, reviewId, startReview]);

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
      if (ln) {
        const withLink = withReportLink(ln);
        setLines((prev) => [...prev, { ...withLink, key }]);
        if (withLink.url) {
          const aid = artifactIdFromUrl(withLink.url);
          if (aid) onReportRef.current?.(aid);
        }
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
    phase === 'done' ? 'Review complete' : 'Agents reviewing live';

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-bg/60 backdrop-blur-sm" />
      <aside className="relative z-10 flex h-full w-full max-w-xl flex-col border-l border-border bg-surface shadow-2xl">
        <header className="glass sticky top-0 flex items-start justify-between gap-3 border-b border-border px-5 py-4">
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

        <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-5 py-5">
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
              {phase === 'done' ? <p className="pt-1 text-xs text-faint">The agents have finished. The verdict is recorded on the material.</p> : null}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
