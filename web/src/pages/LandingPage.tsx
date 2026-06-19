import { Link } from 'react-router-dom';
import type { CSSProperties, ReactNode } from 'react';

// The front door. A full-bleed landing that lives OUTSIDE the app shell (no
// sidebar, no topbar), so a first-time visitor meets the idea before the tool.
// Everything points one way: into /campaigns. The visual centerpiece is a
// miniature review room that shows three agents disagreeing, because the
// disagreement is the product, not a bug.

const line = (path: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-5 w-5"
    aria-hidden
  >
    {path}
  </svg>
);

// Representative verdicts that scroll across the ticker under the hero. Not live
// data: atmosphere that teaches the verdict vocabulary (Publish / Adapt / Escalate)
// and the region + reviewer split at a glance.
const TICKER: { who: string; verdict: string; tone: string }[] = [
  { who: 'US reviewer', verdict: 'Publish', tone: 'text-human' },
  { who: 'EU reviewer', verdict: 'Adapt', tone: 'text-warn' },
  { who: 'LATAM reviewer', verdict: 'Escalate', tone: 'text-danger' },
  { who: 'Claims reviewer', verdict: 'Substantiated', tone: 'text-human' },
  { who: 'Brand reviewer', verdict: 'Off-voice', tone: 'text-warn' },
  { who: 'US reviewer', verdict: 'Disclosure missing', tone: 'text-danger' },
  { who: 'EU reviewer', verdict: 'Publish', tone: 'text-human' },
  { who: 'Claims reviewer', verdict: 'Needs evidence', tone: 'text-warn' },
];

// The three things that make this not-a-checklist. Copy mirrors the How-It-Works
// page so the two stay in one voice.
const DIFFERENTIATORS: { title: string; body: string; tone: string; icon: ReactNode }[] = [
  {
    title: 'Competing objectives, not a checklist',
    body: 'Each agent defends a different market or goal. When they disagree, they negotiate a tradeoff. The conflict is the point, not a bug.',
    tone: 'text-warn',
    icon: line(
      <>
        <path d="M4 5h9a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H7l-3 2.5z" />
        <path d="M20 19h-9a2 2 0 0 1-2-2" />
      </>,
    ),
  },
  {
    title: 'It sees video and images, not just text',
    body: 'A perception pass transcribes the audio and reads the frames, so a claim hidden in a voiceover or on a banner still gets caught.',
    tone: 'text-accent',
    icon: line(
      <>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </>,
    ),
  },
  {
    title: 'Built for a whole campaign',
    body: 'Reviews every advertisement, every material and every region concurrently, then rolls the verdicts up so you see the worst case at a glance.',
    tone: 'text-human',
    icon: line(
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>,
    ),
  },
];

// The three verdicts a campaign can come back with, in plain language.
const VERDICTS: { label: string; tone: string; desc: string }[] = [
  { label: 'Publish', tone: 'bg-human/10 text-human ring-human/25', desc: 'Cleared to ship in that market.' },
  { label: 'Adapt', tone: 'bg-warn/10 text-warn ring-warn/25', desc: 'Fixable: the copy is rewritten and re-reviewed.' },
  { label: 'Escalate', tone: 'bg-danger/10 text-danger ring-danger/25', desc: 'A genuine deadlock goes to a human.' },
];

export function LandingPage() {
  return (
    <div className="relative z-10 flex min-h-screen flex-col">
      <LandingNav />

      <main className="flex-1">
        <Hero />
        <Ticker />
        <Differentiators />
        <ClosingCta />
      </main>

      <LandingFooter />
    </div>
  );
}

function LandingNav() {
  return (
    <header className="sticky top-0 z-30">
      <div className="glass border-x-0 border-t-0">
        <div className="mx-auto flex w-full max-w-[88rem] items-center justify-between px-4 py-3.5 sm:px-6 lg:px-10">
          <Link to="/" className="flex items-center gap-3">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent-strong to-indigo-700 shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_8px_20px_-8px_rgb(99_102_241/0.7)]">
              <span className="font-display text-lg italic leading-none text-white">B</span>
            </span>
            <div className="leading-tight">
              <p className="font-display text-xl leading-none text-fg">Band of Agents</p>
              <p className="eyebrow mt-1">Campaign Review</p>
            </div>
          </Link>

          <nav className="flex items-center gap-2 sm:gap-3">
            <Link
              to="/how-it-works"
              className="hidden rounded-xl px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-fg sm:inline-flex"
            >
              How it works
            </Link>
            <Link to="/campaigns" className="btn btn-primary">
              Open the board
              <Arrow />
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="mx-auto grid w-full max-w-[88rem] items-center gap-12 px-4 pb-12 pt-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:px-10 lg:pb-16 lg:pt-24">
      <div className="max-w-xl">
        <p className="eyebrow rise" style={delay(0)}>
          Multi-agent campaign review
        </p>

        <h1
          className="rise mt-5 font-display text-5xl leading-[0.98] tracking-tight text-fg sm:text-6xl lg:text-7xl"
          style={delay(80)}
        >
          Competing agents review your campaign.{' '}
          <span className="italic text-gradient">The conflict is the point.</span>
        </h1>

        <p className="rise mt-6 text-lg leading-relaxed text-muted" style={delay(160)}>
          A band of specialist agents, each on a different model and defending a different market,
          debate one piece of marketing. They read the video and the images, reconcile a verdict,
          and escalate a genuine deadlock to you. Not a pipeline. A negotiation.
        </p>

        <div className="rise mt-9 flex flex-wrap items-center gap-3" style={delay(240)}>
          <Link to="/campaigns" className="btn btn-primary px-5 py-2.5 text-[15px]">
            Enter the review room
            <Arrow />
          </Link>
          <Link to="/how-it-works" className="btn btn-ghost px-5 py-2.5 text-[15px]">
            See how it works
          </Link>
        </div>

        <dl className="rise mt-10 flex flex-wrap gap-x-8 gap-y-4" style={delay(320)}>
          {[
            { k: 'Agents per review', v: '6+' },
            { k: 'Models in the room', v: '4' },
            { k: 'Markets', v: 'US · EU · LATAM' },
          ].map((s) => (
            <div key={s.k}>
              <dt className="eyebrow">{s.k}</dt>
              <dd className="mt-1.5 font-display text-2xl text-fg">{s.v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="rise lg:justify-self-end" style={delay(220)}>
        <ReviewRoomPreview />
      </div>
    </section>
  );
}

// A miniature, static review room. It does the explaining the headline promises:
// three agents on three models, three different stances, ending in a human
// escalation because they could not reconcile.
function ReviewRoomPreview() {
  const agents: { name: string; model: string; dot: string; stance: string; verdict: string; tone: string }[] = [
    {
      name: 'US reviewer',
      model: 'Gemini',
      dot: 'bg-accent',
      stance: 'The "30% faster" claim needs an on-screen disclosure.',
      verdict: 'Adapt',
      tone: 'bg-warn/12 text-warn ring-warn/25',
    },
    {
      name: 'Brand reviewer',
      model: 'Claude',
      dot: 'bg-human',
      stance: 'Voice drifts off-brand in the closing call to action.',
      verdict: 'Adapt',
      tone: 'bg-warn/12 text-warn ring-warn/25',
    },
    {
      name: 'Claims reviewer',
      model: 'Llama',
      dot: 'bg-accent',
      stance: 'Evidence in the dossier backs the headline. Ship it.',
      verdict: 'Publish',
      tone: 'bg-human/12 text-human ring-human/25',
    },
  ];

  return (
    <div className="surface w-full max-w-md rounded-2xl p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="h-2 w-2 animate-pulse-soft rounded-full bg-human" />
          <span className="font-mono text-xs text-muted">Spring Launch · live review</span>
        </div>
        <span className="eyebrow">Room 14</span>
      </div>

      <div className="mt-5 flex flex-col gap-2.5">
        {agents.map((a) => (
          <div key={a.name} className="surface-2 flex items-start gap-3 rounded-xl p-3.5">
            <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${a.dot}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium text-fg">{a.name}</p>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${a.tone}`}
                >
                  {a.verdict}
                </span>
              </div>
              <p className="mt-1 text-[13px] leading-snug text-muted">{a.stance}</p>
              <p className="eyebrow mt-1.5">on {a.model}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3 rounded-xl border border-danger/30 bg-danger/[0.06] px-3.5 py-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-danger/15 text-danger">
          {line(<><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></>)}
        </span>
        <div>
          <p className="text-sm font-medium text-fg">Deadlock. Escalated to a human.</p>
          <p className="text-[12px] text-muted">Two markets cannot reconcile the disclosure.</p>
        </div>
      </div>
    </div>
  );
}

// A slim, edge-faded ticker of verdicts scrolling forever. The content is
// duplicated so the -50% translate loops seamlessly.
function Ticker() {
  const items = [...TICKER, ...TICKER];
  return (
    <div className="border-y border-border/70 bg-bg-soft/40">
      <div className="mx-auto flex w-full max-w-[88rem] items-center gap-4 px-4 py-3 sm:px-6 lg:px-10">
        <span className="eyebrow hidden shrink-0 sm:inline">Verdicts, live</span>
        <div className="relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
          <div className="flex w-max animate-marquee items-center gap-6">
            {items.map((t, i) => (
              <span key={i} className="flex shrink-0 items-center gap-2 font-mono text-xs">
                <span className="text-faint">{t.who}</span>
                <span className="text-border-strong">·</span>
                <span className={t.tone}>{t.verdict}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Differentiators() {
  return (
    <section className="mx-auto w-full max-w-[88rem] px-4 py-16 sm:px-6 lg:px-10 lg:py-24">
      <div className="max-w-2xl">
        <p className="eyebrow">Why it is different</p>
        <h2 className="mt-4 font-display text-3xl text-fg sm:text-4xl">
          A review board, not a rubber stamp.
        </h2>
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {DIFFERENTIATORS.map((d) => (
          <div key={d.title} className="surface flex flex-col rounded-2xl p-6">
            <span className={`flex h-10 w-10 items-center justify-center rounded-xl bg-surface-3 ${d.tone}`}>
              {d.icon}
            </span>
            <h3 className="mt-5 text-base font-semibold text-fg">{d.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{d.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-3">
        {VERDICTS.map((v) => (
          <div key={v.label} className="surface-2 flex items-center gap-3 rounded-xl px-4 py-3.5">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${v.tone}`}>
              {v.label}
            </span>
            <span className="text-[13px] text-muted">{v.desc}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ClosingCta() {
  return (
    <section className="mx-auto w-full max-w-[88rem] px-4 pb-20 sm:px-6 lg:px-10">
      <div className="surface relative overflow-hidden rounded-2xl px-6 py-12 text-center sm:px-12 sm:py-16">
        {/* Two soft colour pools echoing the app canvas, kept inside the card. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-80"
          style={{
            backgroundImage:
              'radial-gradient(36rem 22rem at 18% -20%, rgba(99,102,241,0.16), transparent 60%), radial-gradient(30rem 20rem at 100% 120%, rgba(16,185,129,0.12), transparent 60%)',
          }}
        />
        <div className="relative">
          <h2 className="mx-auto max-w-2xl font-display text-4xl leading-tight text-fg sm:text-5xl">
            Put your campaign in front of the band.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-muted">
            Drop in an advertisement, watch the agents argue it out in real time, and get a verdict
            you can defend.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/campaigns" className="btn btn-primary px-5 py-2.5 text-[15px]">
              Open the campaigns board
              <Arrow />
            </Link>
            <Link to="/how-it-works" className="btn btn-ghost px-5 py-2.5 text-[15px]">
              See how it works
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function LandingFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-[88rem] flex-col items-center justify-between gap-3 px-4 py-6 sm:flex-row sm:px-6 lg:px-10">
        <p className="font-display text-lg text-fg">Band of Agents</p>
        <div className="flex items-center gap-2 text-[11px] text-faint">
          <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-human" />
          <span className="font-mono">band.ai · agents online</span>
        </div>
      </div>
    </footer>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function delay(ms: number): CSSProperties {
  return { '--d': `${ms}ms` } as CSSProperties;
}
