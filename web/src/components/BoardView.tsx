import { useState } from 'react';
import type { BoardState } from '../boardState';
import { ConflictBanner } from './ConflictBanner';
import { PipelineDiagram } from './PipelineDiagram';
import { StatusBadge } from './StatusBadge';
import { Timeline } from './Timeline';

interface BoardViewProps {
  state: BoardState;
}

export function BoardView({ state }: BoardViewProps) {
  // Timeline is a secondary, collapsible panel under the diagram.
  const [showTimeline, setShowTimeline] = useState(false);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow mb-2">Compliance board</p>
          <h1 className="font-display text-3xl leading-none text-fg">Lumavida review</h1>
          {state.asset ? (
            <p className="mt-1.5 font-mono text-[11px] text-faint">
              {state.asset.channel} · {state.asset.markets.join(', ') || 'no markets'}
            </p>
          ) : null}
        </div>
        <StatusBadge status={state.status} />
      </div>

      {state.conflict ? <ConflictBanner /> : null}

      {/* Presentation centerpiece: the live multi-agent pipeline. */}
      <PipelineDiagram state={state} />

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
