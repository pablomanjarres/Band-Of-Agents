import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listPrecedents, listReviews } from '../api';
import type { BoardStatus, Precedent, ReviewSummary } from '../types';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; reviews: ReviewSummary[] };

type PrecedentState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; precedents: Precedent[] };

const STATUS_STYLES: Record<BoardStatus, string> = {
  running: 'bg-accent/10 text-accent ring-1 ring-inset ring-accent/25',
  'awaiting-decision': 'bg-warn/10 text-warn ring-1 ring-inset ring-warn/25',
  complete: 'bg-human/10 text-human ring-1 ring-inset ring-human/25',
  error: 'bg-danger/10 text-danger ring-1 ring-inset ring-danger/25',
};

function formatDate(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleString();
}

export function HistoryPage() {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [precedents, setPrecedents] = useState<PrecedentState>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    listReviews()
      .then((res) => {
        if (active) setLoad({ kind: 'ready', reviews: res.reviews });
      })
      .catch((err: unknown) => {
        if (active) {
          setLoad({
            kind: 'error',
            message: err instanceof Error ? err.message : 'Failed to load history.',
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    listPrecedents()
      .then((res) => {
        if (active) setPrecedents({ kind: 'ready', precedents: res.precedents });
      })
      .catch((err: unknown) => {
        if (active) {
          setPrecedents({
            kind: 'error',
            message: err instanceof Error ? err.message : 'Failed to load precedents.',
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-2.5">Reviews</p>
          <h1 className="font-display text-4xl leading-none text-fg">Review boards</h1>
          <p className="mt-2 text-sm text-muted">
            Reviews you start in band.ai appear here automatically.
          </p>
        </div>
        <Link to="/" className="btn btn-primary shrink-0">
          + Compose campaign
        </Link>
      </div>

      {load.kind === 'loading' ? (
        <p className="text-sm text-muted">Loading history…</p>
      ) : load.kind === 'error' ? (
        <p className="text-sm text-danger">{load.message}</p>
      ) : load.reviews.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border-strong bg-surface/40 p-10 text-center text-sm text-muted">
          No reviews yet. Start one in the band.ai room and it will appear here.
        </div>
      ) : (
        <ul className="surface divide-y divide-border overflow-hidden rounded-2xl">
          {load.reviews.map((review) => (
            <li key={review.id}>
              <Link
                to={`/history/${review.id}`}
                className="group flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-surface-2/60"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg">{review.copy}</p>
                  <p className="mt-1 font-mono text-[11px] text-faint">
                    {review.markets.join(', ') || 'no markets'} · {formatDate(review.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {review.conflict ? (
                    <span className="rounded-full bg-warn/10 px-2 py-0.5 text-xs font-semibold text-warn ring-1 ring-inset ring-warn/25">
                      conflict
                    </span>
                  ) : null}
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[review.status]}`}>
                    {review.status}
                  </span>
                  <span className="text-faint transition-transform group-hover:translate-x-0.5" aria-hidden>
                    ›
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section className="space-y-3 pt-4">
        <h2 className="font-display text-2xl text-fg">Precedent log</h2>
        {precedents.kind === 'loading' ? (
          <p className="text-sm text-muted">Loading precedents…</p>
        ) : precedents.kind === 'error' ? (
          <p className="text-sm text-danger">{precedents.message}</p>
        ) : precedents.precedents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border-strong bg-surface/40 p-6 text-center text-sm text-muted">
            No precedents recorded yet.
          </div>
        ) : (
          <ul className="surface divide-y divide-border overflow-hidden rounded-2xl">
            {precedents.precedents.map((precedent) => (
              <li key={precedent.roomId} className="flex items-start gap-3 px-5 py-3.5">
                <span className="mt-0.5 shrink-0 rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted ring-1 ring-inset ring-border-strong">
                  {precedent.regions.join(', ') || 'no regions'}
                </span>
                <p className="text-sm text-muted">{precedent.decision}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
