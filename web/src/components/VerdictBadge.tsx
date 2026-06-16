import type { RegionStatus } from '../boardState';
import type { VerdictDecision } from '../types';

// Shared verdict styling for campaign rows/cells/badges. "reviewing" is the
// not-yet-decided state; the three real verdicts mirror StatusChip's palette.
const STYLES: Record<RegionStatus, string> = {
  publish: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  adapt: 'bg-amber-100 text-amber-700 ring-amber-200',
  escalate: 'bg-red-100 text-red-700 ring-red-200',
  reviewing: 'bg-slate-200 text-slate-600 ring-slate-300',
};

const LABELS: Record<RegionStatus, string> = {
  publish: 'publish',
  adapt: 'adapt',
  escalate: 'escalate',
  reviewing: 'reviewing',
};

export function VerdictBadge({
  status,
  pulse = false,
}: {
  status: RegionStatus;
  pulse?: boolean;
}) {
  const animate = pulse && status === 'reviewing' ? 'animate-pulse-soft' : '';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${STYLES[status]} ${animate}`}
    >
      {LABELS[status]}
    </span>
  );
}

// The aggregate campaign badge: a decided verdict, or a neutral "not reviewed"
// pill when no material has produced a verdict yet (undefined).
export function AggregateBadge({ decision }: { decision?: VerdictDecision }) {
  if (!decision) {
    return (
      <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-inset ring-slate-200">
        not reviewed
      </span>
    );
  }
  return <VerdictBadge status={decision} />;
}
