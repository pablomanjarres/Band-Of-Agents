import type { BoardStatus } from '../types';

const STYLES: Record<BoardStatus, string> = {
  running: 'bg-accent/10 text-accent ring-accent/25',
  'awaiting-decision': 'bg-warn/10 text-warn ring-warn/25',
  complete: 'bg-human/10 text-human ring-human/25',
  error: 'bg-danger/10 text-danger ring-danger/25',
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
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
        </span>
      ) : null}
      {LABELS[status]}
    </span>
  );
}
