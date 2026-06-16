import type { RegionStatus } from '../boardState';
import type { VerdictDecision } from '../types';

// Shared verdict styling for campaign rows/cells/badges. "reviewing" is the
// not-yet-decided state; the three real verdicts mirror StatusChip's palette.
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
      <span className="inline-flex items-center rounded-full bg-surface-3 px-2.5 py-0.5 text-xs font-medium text-muted ring-1 ring-inset ring-border-strong">
        not reviewed
      </span>
    );
  }
  return <VerdictBadge status={decision} />;
}
