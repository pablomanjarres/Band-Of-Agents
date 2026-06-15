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
          <h1 className="text-xl font-bold text-slate-900">Compliance Board</h1>
          {state.asset ? (
            <p className="text-sm text-slate-500">
              {state.asset.channel} - {state.asset.markets.join(', ') || 'no markets'}
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
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm transition hover:bg-slate-50"
        >
          <span className={`transition-transform ${showTimeline ? 'rotate-90' : ''}`}>&rsaquo;</span>
          {showTimeline ? 'Hide event timeline' : 'Show event timeline'}
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
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
