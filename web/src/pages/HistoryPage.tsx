import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listReviews } from '../api';
import type { BoardStatus, ReviewSummary } from '../types';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; reviews: ReviewSummary[] };

const STATUS_STYLES: Record<BoardStatus, string> = {
  running: 'bg-indigo-100 text-indigo-700',
  'awaiting-decision': 'bg-amber-100 text-amber-700',
  complete: 'bg-emerald-100 text-emerald-700',
  error: 'bg-red-100 text-red-700',
};

function formatDate(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleString();
}

export function HistoryPage() {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });

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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">Review history</h1>
        <Link
          to="/"
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
        >
          + New review
        </Link>
      </div>

      {load.kind === 'loading' ? (
        <p className="text-sm text-slate-500">Loading history.</p>
      ) : load.kind === 'error' ? (
        <p className="text-sm text-red-600">{load.message}</p>
      ) : load.reviews.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No reviews yet. Submit one from the New review tab.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {load.reviews.map((review) => (
            <li key={review.id}>
              <Link
                to={`/history/${review.id}`}
                className="flex items-center justify-between gap-4 px-5 py-4 transition hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{review.copy}</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {review.markets.join(', ') || 'no markets'} - {formatDate(review.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {review.conflict ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                      conflict
                    </span>
                  ) : null}
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[review.status]}`}
                  >
                    {review.status}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
