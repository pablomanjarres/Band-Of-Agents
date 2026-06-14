import type { RegionStatus } from '../boardState';

const STYLES: Record<RegionStatus, string> = {
  publish: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  adapt: 'bg-amber-100 text-amber-700 ring-amber-200',
  escalate: 'bg-red-100 text-red-700 ring-red-200',
  reviewing: 'bg-slate-200 text-slate-600 ring-slate-300 animate-pulse-soft',
};

const LABELS: Record<RegionStatus, string> = {
  publish: 'publish',
  adapt: 'adapt',
  escalate: 'escalate',
  reviewing: 'reviewing',
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
