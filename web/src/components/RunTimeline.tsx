import type { Run, RunEvent, RunStage, RunStatus } from '../types';

// The live run timeline: each band.ai lifecycle beat as a row, newest at the bottom.
// This is the visible bridge between band.ai and the dashboard.
const STAGE_TONE: Record<RunStage, { dot: string; label: string }> = {
  requested: { dot: 'bg-accent', label: 'requested' },
  perceiving: { dot: 'bg-violet-400', label: 'perceiving' },
  reviewing: { dot: 'bg-sky-400', label: 'reviewing' },
  report: { dot: 'bg-human', label: 'report' },
  'awaiting-decision': { dot: 'bg-warn', label: 'awaiting you' },
  decided: { dot: 'bg-human', label: 'decided' },
  material: { dot: 'bg-teal-400', label: 'new material' },
  log: { dot: 'bg-faint', label: 'log' },
};

const STATUS_TONE: Record<RunStatus, { text: string; dot: string; label: string }> = {
  running: { text: 'text-accent', dot: 'bg-accent animate-pulse-soft', label: 'Running' },
  'awaiting-decision': { text: 'text-warn', dot: 'bg-warn', label: 'Awaiting your decision in band.ai' },
  complete: { text: 'text-human', dot: 'bg-human', label: 'Complete' },
  error: { text: 'text-danger', dot: 'bg-danger', label: 'Error' },
};

function clock(at: number): string {
  try {
    return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

export function RunTimeline({ run }: { run: Run }) {
  const status = STATUS_TONE[run.status];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-semibold text-fg">{run.label}</p>
        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold ${status.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
          {status.label}
        </span>
      </div>

      {run.events.length === 0 ? (
        <p className="text-xs text-faint">Waiting for the first beat from the agents…</p>
      ) : (
        <ol className="space-y-2.5">
          {run.events.map((event) => (
            <RunRow key={event.seq} event={event} />
          ))}
        </ol>
      )}
    </div>
  );
}

function RunRow({ event }: { event: RunEvent }) {
  const tone = STAGE_TONE[event.stage];
  return (
    <li className="relative pl-4">
      <span className={`absolute left-0 top-1.5 h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-faint">{tone.label}</span>
        <span className="font-mono text-[10px] text-surface-3">{clock(event.at)}</span>
      </div>
      <p className="text-xs leading-snug text-fg/90">
        {event.agent ? <span className="font-medium text-muted">{event.agent}: </span> : null}
        {event.message}
      </p>
      {event.artifact ? <ArtifactChip artifact={event.artifact} /> : null}
    </li>
  );
}

function ArtifactChip({ artifact }: { artifact: NonNullable<RunEvent['artifact']> }) {
  if (artifact.kind === 'image') {
    return (
      <a
        href={artifact.url}
        target="_blank"
        rel="noreferrer"
        className="mt-1.5 block overflow-hidden rounded-lg border border-teal-400/30 bg-teal-500/[0.06] transition-colors hover:border-teal-400/60"
      >
        <img src={artifact.url} alt={artifact.title ?? 'new material'} className="h-24 w-full object-cover" />
        <span className="block px-2 py-1 text-[10px] font-medium text-teal-200">{artifact.title ?? 'New material proposed'}</span>
      </a>
    );
  }
  return (
    <a
      href={artifact.url}
      target="_blank"
      rel="noreferrer"
      className="mt-1.5 inline-flex items-center gap-1 rounded-lg border border-human/30 bg-human/10 px-2 py-1 text-[11px] font-medium text-human transition-colors hover:bg-human/15"
    >
      {artifact.title ?? 'View report'}
    </a>
  );
}
