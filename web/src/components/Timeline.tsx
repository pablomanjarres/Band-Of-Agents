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
  perceiving: 'Perceiving',
  workitem: 'Work item',
  debate: 'Debate',
  'pod-finding': 'Pod finding',
  mediation: 'Mediation',
  adjudication: 'Adjudication',
  terminal: 'Terminal',
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
    case 'perceiving':
      return event.stage === 'done'
        ? 'Perception complete.'
        : `Analyzing ${event.stage} frame ${event.index + 1}/${event.total}.`;
    case 'workitem':
    case 'debate':
      return event.text;
    case 'pod-finding':
      return `${event.pod} pod filed: ${event.conflicts} conflict(s). ${event.text}`;
    case 'mediation':
      return `${event.resolved ? 'Resolved' : 'No movement'}: ${event.text}`;
    case 'adjudication':
      return `Decision ${event.decision}: ${event.text}`;
    case 'terminal':
      return `Spine reached ${event.decision}.`;
    default: {
      const _never: never = event;
      return _never;
    }
  }
}

const DOT_COLORS: Record<BoardEvent['type'], string> = {
  intake: 'bg-muted',
  recruited: 'bg-accent',
  review: 'bg-muted',
  progress: 'bg-faint',
  verdict: 'bg-accent-strong',
  revised: 'bg-human',
  escalation: 'bg-danger',
  decision: 'bg-human',
  log: 'bg-faint',
  status: 'bg-accent/70',
  perceiving: 'bg-warn',
  workitem: 'bg-faint',
  debate: 'bg-warn',
  'pod-finding': 'bg-accent',
  mediation: 'bg-warn',
  adjudication: 'bg-accent-strong',
  terminal: 'bg-human',
};

export function Timeline({ events }: { events: BoardEvent[] }) {
  const lines: TimelineLine[] = events.map((event, index) => ({
    key: `${event.seq}-${event.type}-${index}`,
    label: TYPE_LABELS[event.type],
    detail: describe(event),
  }));

  return (
    <section className="surface rounded-2xl p-5">
      <p className="eyebrow">Timeline</p>
      {lines.length === 0 ? (
        <p className="mt-3 text-sm text-faint">Waiting for the first event…</p>
      ) : (
        <ol className="mt-4 space-y-3">
          {lines.map((line, index) => (
            <li key={line.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-bg-soft ${DOT_COLORS[events[index].type]}`}
                />
                {index < lines.length - 1 ? (
                  <span className="mt-1 w-px grow bg-border" />
                ) : null}
              </div>
              <div className="pb-1">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-faint">
                  {line.label}
                </p>
                <p className="mt-0.5 text-sm text-muted">{line.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
