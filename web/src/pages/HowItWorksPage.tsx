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

// The step-by-step walkthrough. Each step shows the concrete action and an example
// of what is said in the room: who posts it (you), or that it happens automatically.
type ExampleKind = 'post' | 'auto' | 'you';
const EXAMPLE_TONE: Record<ExampleKind, { label: string; cls: string }> = {
  post: { label: 'you post', cls: 'text-accent' },
  auto: { label: 'agents', cls: 'text-faint' },
  you: { label: 'your ruling', cls: 'text-human' },
};

const STEPS: { n: string; title: string; body: string; example: string; kind: ExampleKind }[] = [
  {
    n: '1',
    title: 'Add your campaign',
    body: 'Create a campaign, then add advertisements and drop materials into each (video, post, image, banner) with their copy and the claim they make.',
    example: 'Upload hero.mp4, paste the copy + the claim it makes',
    kind: 'post',
  },
  {
    n: '2',
    title: 'Fill the dossier once',
    body: 'Add the approved claims and substantiation at the campaign level. It cascades into every reviewer of every material, so they all judge against the same ground truth.',
    example: 'Approved claim: "Clinically supported to help maintain a healthy immune response" + trial refs',
    kind: 'post',
  },
  {
    n: '3',
    title: 'Kick off the review',
    body: 'In the portal, click Run review (or Review this ad). In a Band.ai room, tag the Coordinator with the campaign name.',
    example: '@Coordinator review the Immune+ Q3 campaign',
    kind: 'post',
  },
  {
    n: '4',
    title: 'The Coordinator recruits',
    body: 'It pulls in the reviewers for the markets you target and tells them to report to Reconcile. You never tag the individual reviewers yourself.',
    example: '@US @EU @LATAM @Brand review this and report to @Reconcile',
    kind: 'auto',
  },
  {
    n: '5',
    title: 'Reviewers check in parallel',
    body: 'Each market reviewer checks against its own rulebook; Brand checks voice and consistency. They file findings to the shared board at the same time.',
    example: 'EU Reviewer: 4 findings, 3 blocking',
    kind: 'auto',
  },
  {
    n: '6',
    title: 'Reconcile decides',
    body: 'Once every review is in, Reconcile posts a verdict per region: publish, adapt, or escalate. Adapt is handed to Remediation; an escalate comes to you.',
    example: 'Verdicts: US=escalate, EU=publish, LATAM=publish, Brand=publish',
    kind: 'auto',
  },
  {
    n: '7',
    title: 'Remediation fixes, or you rule',
    body: 'Remediation rewrites the adapt regions and resubmits for a re-review. On a genuine deadlock, Reconcile asks you for the final call, and your decision is logged as precedent.',
    example: 'Hold US: drop the auto-renewal, resubmit with clear pricing',
    kind: 'you',
  },
];

const AGENTS: { name: string; role: string; when: string; tone: 'accent' | 'warn' | 'human' }[] = [
  {
    name: 'Coordinator',
    role: 'Chairs the review. Recruits the right reviewers for the markets you target and points them at their rulebooks and Reconcile.',
    when: 'Tag to start',
    tone: 'accent',
  },
  {
    name: 'US / EU / LATAM',
    role: "One reviewer per market. Each checks the content against that region's regulatory rulebook and files findings.",
    when: 'Auto, per market',
    tone: 'accent',
  },
  {
    name: 'Brand',
    role: 'Checks voice, tone and consistency against the brand DNA, independent of the regional rules.',
    when: 'Auto, always',
    tone: 'accent',
  },
  {
    name: 'Reconcile',
    role: 'Collects every review, decides the per-region verdict, and routes the room: adapt to Remediation, deadlocks to you.',
    when: 'Auto, gives the verdict',
    tone: 'warn',
  },
  {
    name: 'Remediation',
    role: 'Rewrites non-compliant copy (and can regenerate an image) for adapt regions, then resubmits for a re-review.',
    when: 'Auto, on adapt',
    tone: 'warn',
  },
  {
    name: 'Compliance lead (you)',
    role: 'Rules on genuine deadlocks the agents could not resolve. Your call is recorded as precedent for next time.',
    when: 'On escalate',
    tone: 'human',
  },
];

const WHEN_TONE: Record<'accent' | 'warn' | 'human', string> = {
  accent: 'bg-accent/10 text-accent ring-accent/25',
  warn: 'bg-warn/10 text-warn ring-warn/25',
  human: 'bg-human/10 text-human ring-human/25',
};

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

      {/* Step by step: how to actually run one. */}
      <section>
        <div className="mb-6 text-center">
          <p className="eyebrow mb-2">Step by step</p>
          <h2 className="font-display text-3xl text-fg">Running a review, start to finish</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted">
            The same flow whether you click through the portal or drive it by tagging agents in a Band.ai room. You
            only ever start it; the agents hand off to each other from there.
          </p>
        </div>
        <ol className="mx-auto max-w-3xl space-y-3">
          {STEPS.map((s, i) => (
            <li
              key={s.n}
              className="rise surface flex gap-4 rounded-2xl p-5"
              style={{ '--d': `${i * 60}ms` } as CSSProperties}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-3 font-mono text-sm font-semibold text-fg ring-1 ring-inset ring-border-strong">
                {s.n}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-lg leading-tight text-fg">{s.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">{s.body}</p>
                <div className="mt-2.5 flex items-center gap-2 overflow-hidden rounded-lg border border-border bg-bg-soft/70 px-3 py-2">
                  <span className={`shrink-0 font-mono text-[9px] font-semibold uppercase tracking-wider ${EXAMPLE_TONE[s.kind].cls}`}>
                    {EXAMPLE_TONE[s.kind].label}
                  </span>
                  <code className="truncate font-mono text-[12px] text-fg/90">{s.example}</code>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Meet the agents: what each does and when it runs. */}
      <section>
        <div className="mb-6 text-center">
          <p className="eyebrow mb-2">The cast</p>
          <h2 className="font-display text-3xl text-fg">What each agent does</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted">
            You only ever tag the Coordinator. It brings in everyone else, and the rest run themselves.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {AGENTS.map((a, i) => (
            <div
              key={a.name}
              className="rise surface flex flex-col rounded-2xl p-5"
              style={{ '--d': `${i * 60}ms` } as CSSProperties}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display text-lg leading-tight text-fg">{a.name}</h3>
                <span className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider ring-1 ring-inset ${WHEN_TONE[a.tone]}`}>
                  {a.when}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted">{a.role}</p>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-5 max-w-2xl text-center text-xs leading-relaxed text-faint">
          There is also a deeper "pods" topology (a Conductor, pod leads, a Mediator and a Risk Adjudicator) for the
          full debate showcase. The cast above is the one that returns a clean per-region verdict.
        </p>
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
