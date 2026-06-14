import type { BoardStatus } from '../types';

const STYLES: Record<BoardStatus, string> = {
  running: 'bg-indigo-100 text-indigo-700 ring-indigo-200',
  'awaiting-decision': 'bg-amber-100 text-amber-700 ring-amber-200',
  complete: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  error: 'bg-red-100 text-red-700 ring-red-200',
};

const LABELS: Record<BoardStatus, string> = {
  running: 'Running',
  'awaiting-decision': 'Awaiting decision',
  complete: 'Complete',
  error: 'Error',
};

export function StatusBadge({ status }: { status: BoardStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${STYLES[status]}`}
    >
      {status === 'running' ? (
        <span className="h-2 w-2 animate-pulse-soft rounded-full bg-current" />
      ) : null}
      {LABELS[status]}
    </span>
  );
}
