import type { BoardState } from '../boardState';
import { orderedRegions } from '../boardState';
import { ConflictBanner } from './ConflictBanner';
import { EscalationDecision } from './EscalationDecision';
import { RegionCard } from './RegionCard';
import { RemediationPanel } from './RemediationPanel';
import { StatusBadge } from './StatusBadge';
import { Timeline } from './Timeline';

interface BoardViewProps {
  state: BoardState;
  // Provided only for live boards that can accept a human decision.
  onDecision?: (decision: string) => Promise<void> | void;
}

export function BoardView({ state, onDecision }: BoardViewProps) {
  const regions = orderedRegions(state);
  const showEscalation = Boolean(state.escalationText);
  const awaitingDecision = state.status === 'awaiting-decision';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Lumavida Compliance Board</h1>
          {state.asset ? (
            <p className="text-sm text-slate-500">
              {state.asset.channel} - {state.asset.markets.join(', ') || 'no markets'}
            </p>
          ) : null}
        </div>
        <StatusBadge status={state.status} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {regions.map((region) => (
          <RegionCard key={region.region} region={region} />
        ))}
      </div>

      {state.conflict ? <ConflictBanner /> : null}

      {state.remediation ? <RemediationPanel remediation={state.remediation} /> : null}

      {showEscalation ? (
        <EscalationDecision
          text={state.escalationText ?? ''}
          recordedDecision={state.decisionText}
          // Allow input only on a live board that is awaiting a decision.
          onSubmit={awaitingDecision ? onDecision : undefined}
        />
      ) : null}

      <Timeline events={state.events} />
    </div>
  );
}
