import type { RegionStatus } from '../boardState';

const STYLES: Record<RegionStatus, string> = {
  publish: 'bg-human/10 text-human ring-human/25',
  adapt: 'bg-warn/10 text-warn ring-warn/25',
  escalate: 'bg-danger/10 text-danger ring-danger/25',
  reviewing: 'bg-surface-3 text-muted ring-border-strong',
};

const LABELS: Record<RegionStatus, string> = {
  publish: 'publish',
  adapt: 'adapt',
  escalate: 'escalate',
  reviewing: 'not validated',
};

export function StatusChip({ status }: { status: RegionStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}
