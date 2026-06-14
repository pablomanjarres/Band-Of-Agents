import type { BoardEvent } from '../types';

interface TimelineLine {
  key: string;
  label: string;
  detail: string;
}

const TYPE_LABELS: Record<BoardEvent['type'], string> = {
  intake: 'Intake',
  recruited: 'Recruited',
  review: 'Review',
  progress: 'Progress',
  verdict: 'Verdict',
  revised: 'Remediation',
  escalation: 'Escalation',
  decision: 'Decision',
  log: 'Log',
  status: 'Status',
};

function describe(event: BoardEvent): string {
  switch (event.type) {
    case 'intake':
      return `Asset ${event.asset.id} received for ${event.asset.markets.join(', ') || 'no markets'}.`;
    case 'recruited':
      return event.text;
    case 'review':
      return `${event.region}: ${event.findings.length} finding(s), ${event.blocking} blocking (${event.reviewerName}).`;
    case 'progress':
      return event.text;
    case 'verdict': {
      const summary = event.verdicts.map((v) => `${v.region} ${v.decision}`).join(', ');
      return `${summary}${event.conflict ? ' (conflict)' : ''}.`;
    }
    case 'revised':
      return `Rewrote copy for ${event.region}${event.imageUrl ? ' and generated a new image' : ''}.`;
    case 'escalation':
      return event.text;
    case 'decision':
      return event.text;
    case 'log':
      return `${event.messageType}: ${event.text}`;
    case 'status':
      return `Status is now ${event.status}.`;
    default: {
      const _never: never = event;
      return _never;
    }
  }
}

const DOT_COLORS: Record<BoardEvent['type'], string> = {
  intake: 'bg-slate-400',
  recruited: 'bg-indigo-400',
  review: 'bg-slate-400',
  progress: 'bg-slate-300',
  verdict: 'bg-indigo-500',
  revised: 'bg-emerald-500',
  escalation: 'bg-red-500',
  decision: 'bg-emerald-600',
  log: 'bg-slate-300',
  status: 'bg-indigo-300',
};

export function Timeline({ events }: { events: BoardEvent[] }) {
  const lines: TimelineLine[] = events.map((event, index) => ({
    key: `${event.seq}-${event.type}-${index}`,
    label: TYPE_LABELS[event.type],
    detail: describe(event),
  }));

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Timeline</h2>
      {lines.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">Waiting for the first event.</p>
      ) : (
        <ol className="mt-4 space-y-3">
          {lines.map((line, index) => (
            <li key={line.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${DOT_COLORS[events[index].type]}`}
                />
                {index < lines.length - 1 ? (
                  <span className="mt-1 w-px grow bg-slate-200" />
                ) : null}
              </div>
              <div className="pb-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {line.label}
                </p>
                <p className="text-sm text-slate-700">{line.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
