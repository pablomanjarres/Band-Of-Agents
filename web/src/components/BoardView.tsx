import { useState } from 'react';
import type { BoardState } from '../boardState';
import { orderedRegions } from '../boardState';
import { ConflictBanner } from './ConflictBanner';
import { EscalationDecision } from './EscalationDecision';
import { PipelineDiagram } from './PipelineDiagram';
import { RegionCard } from './RegionCard';
import { StatusBadge } from './StatusBadge';
import { Timeline } from './Timeline';

interface BoardViewProps {
  state: BoardState;
}

// A review runs in one of two topologies and they emit different events. The
// blackboard-pods topology emits pod / mediation / adjudication / terminal events
// that light up the PipelineDiagram. The classic single-asset topology emits
// per-region review + verdict events; the pods diagram cannot show those (its pods
// never fill, so it renders empty), so a classic run is shown as the region verdict
// cards instead. We pick the view from the events actually present in the state.
function isPodsRun(state: BoardState): boolean {
  if (Object.keys(state.pods).length > 0) return true;
  return state.events.some(
    (event) =>
      event.type === 'pod-finding' ||
      event.type === 'mediation' ||
      event.type === 'adjudication' ||
      event.type === 'terminal',
  );
}

export function BoardView({ state }: BoardViewProps) {
  // Timeline is a secondary, collapsible panel under the board.
  const [showTimeline, setShowTimeline] = useState(false);
  const pods = isPodsRun(state);
  const regions = orderedRegions(state);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow mb-2">Compliance board</p>
          <h1 className="font-display text-3xl leading-none text-fg">
            {state.asset?.id ?? 'Compliance review'}
          </h1>
          {state.asset ? (
            <p className="mt-1.5 font-mono text-[11px] text-faint">
              {state.asset.channel} · {state.asset.markets.join(', ') || 'no markets'}
            </p>
          ) : null}
        </div>
        <StatusBadge status={state.status} />
      </div>

      {state.conflict ? <ConflictBanner /> : null}

      {pods ? (
        // Presentation centerpiece for a pods run: the live multi-agent pipeline.
        <PipelineDiagram state={state} />
      ) : (
        // Classic single-asset run: the per-region reviewer verdicts. (The pods
        // diagram would render never-filling, empty pods for these events.)
        <div className="space-y-5">
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {regions.map((region) => (
              <RegionCard key={region.region} region={region} />
            ))}
          </section>

          {state.remediation ? (
            <section className="surface-2 rounded-2xl p-5">
              <p className="eyebrow mb-2">Remediation · {state.remediation.region}</p>
              <p className="text-sm leading-relaxed text-fg/90">{state.remediation.copy}</p>
              {state.remediation.imageUrl ? (
                <img
                  src={state.remediation.imageUrl}
                  alt={`Remediated creative for ${state.remediation.region}`}
                  className="mt-3 aspect-video w-full max-w-md rounded-xl border border-border object-cover"
                />
              ) : null}
            </section>
          ) : null}

          {state.escalationText ? (
            <EscalationDecision text={state.escalationText} recordedDecision={state.decisionText} />
          ) : null}
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={() => setShowTimeline((open) => !open)}
          className="btn btn-ghost"
        >
          <span className={`transition-transform ${showTimeline ? 'rotate-90' : ''}`}>›</span>
          {showTimeline ? 'Hide event timeline' : 'Show event timeline'}
          <span className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] text-muted ring-1 ring-inset ring-border-strong">
            {state.events.length}
          </span>
        </button>

        {showTimeline ? (
          <div className="mt-3">
            <Timeline events={state.events} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
