import { Link } from 'react-router-dom';
import type { CSSProperties, ReactNode } from 'react';
import { WorkflowDiagram } from '../components/WorkflowDiagram';

// The explainer / landing page. The whole point is the workflow at the top: a
// first-time visitor should understand, in one glance, what they put in and what
// they get out. Everything below is supporting context. Kept "clear like water":
// generous whitespace, one idea per section.

const line = (path: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
    {path}
  </svg>
);

const DIFFERENTIATORS: { title: string; body: string; tone: string; icon: ReactNode }[] = [
  {
    title: 'Competing objectives, not a checklist',
    body: 'Each agent defends a different market or goal. When they disagree, they negotiate a tradeoff. The conflict is the point, not a bug.',
    tone: 'text-warn',
    icon: line(<><path d="M4 5h9a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H7l-3 2.5z" /><path d="M20 19h-9a2 2 0 0 1-2-2" /></>),
  },
  {
    title: 'It sees video and images, not just text',
    body: 'A perception pass transcribes the audio and reads the frames, so a claim hidden in a voiceover or on a banner still gets caught.',
    tone: 'text-accent',
    icon: line(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>),
  },
  {
    title: 'Built for a whole campaign',
    body: 'Reviews every advertisement, every material and every region concurrently, then rolls the verdicts up so you see the worst case at a glance.',
    tone: 'text-human',
    icon: line(<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>),
  },
];

const VERDICTS: { label: string; tone: string; desc: string }[] = [
  { label: 'Publish', tone: 'bg-human/10 text-human ring-human/25', desc: 'Cleared to ship in that market.' },
  { label: 'Adapt', tone: 'bg-warn/10 text-warn ring-warn/25', desc: 'Fixable: the copy is rewritten and re-reviewed.' },
  { label: 'Escalate', tone: 'bg-danger/10 text-danger ring-danger/25', desc: 'A genuine deadlock goes to a human.' },
];

export function HowItWorksPage() {
  return (
    <div className="space-y-20">
      {/* Hero: the workflow is the centerpiece. */}
      <section className="text-center">
        <p className="eyebrow mb-3">How it works</p>
        <h1 className="mx-auto max-w-4xl text-balance font-display text-5xl leading-[1.05] text-fg sm:text-6xl">
          From a raw campaign to a verdict you can <span className="text-gradient">defend</span>
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted">
          A team of specialist agents reviews your marketing across every market, debates the conflicts between
          them, and hands you one clear decision, escalating to a human only when it genuinely matters.
        </p>

        <div className="mt-12">
          <WorkflowDiagram />
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-center gap-3">
          <Link to="/campaigns" className="btn btn-primary px-5 py-2.5">
            See the demo campaign
          </Link>
          <Link to="/rulebooks" className="btn btn-ghost px-5 py-2.5">
            Browse the rulebooks
          </Link>
        </div>
      </section>

      {/* What makes it different. */}
      <section>
        <div className="mb-6 text-center">
          <p className="eyebrow mb-2">Why it is different</p>
          <h2 className="font-display text-3xl text-fg">Not a linear pipeline</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {DIFFERENTIATORS.map((d, i) => (
            <div
              key={d.title}
              className="rise surface flex flex-col rounded-2xl p-6"
              style={{ '--d': `${i * 90}ms` } as CSSProperties}
            >
              <span className={d.tone}>{d.icon}</span>
              <h3 className="mt-4 font-display text-xl text-fg">{d.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{d.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* What you get: the three verdicts. */}
      <section>
        <div className="mb-6 text-center">
          <p className="eyebrow mb-2">What you get back</p>
          <h2 className="font-display text-3xl text-fg">A decision per market</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted">
            Every material gets a verdict in each region it targets. The campaign view rolls them up to the worst
            case, so nothing ships by accident.
          </p>
        </div>
        <div className="mx-auto grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
          {VERDICTS.map((v) => (
            <div key={v.label} className="surface flex flex-col items-center gap-3 rounded-2xl p-6 text-center">
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset ${v.tone}`}>
                {v.label}
              </span>
              <p className="text-sm leading-relaxed text-muted">{v.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Closing CTA. */}
      <section className="surface-2 mx-auto flex max-w-3xl flex-col items-center gap-4 rounded-3xl p-10 text-center">
        <h2 className="font-display text-3xl text-fg">Try it on the demo campaign</h2>
        <p className="max-w-xl text-sm leading-relaxed text-muted">
          A campaign is already loaded with advertisements and materials, so you can run a review and watch the
          agents work without setting anything up.
        </p>
        <Link to="/campaigns" className="btn btn-primary px-6 py-2.5">
          Open the workspace
        </Link>
      </section>
    </div>
  );
}
