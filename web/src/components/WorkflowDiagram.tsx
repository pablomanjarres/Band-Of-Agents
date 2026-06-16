import { Fragment, useState, type CSSProperties, type ReactNode } from 'react';

// The centerpiece of the explainer page: a single, legible flow from "you submit
// content" to "you get a final verdict". Two views of the SAME process: a Simple
// three-beat story for a first read, and the Full pipeline that shows the real
// multi-agent work (perception, parallel review, the debate, remediation, human
// escalation). The toggle keeps the page "clear like water": one idea at a time.

type Tone = 'neutral' | 'agent' | 'conflict' | 'human' | 'verdict';

interface Step {
  n: string;
  title: string;
  desc: string;
  tone: Tone;
  icon: ReactNode;
}

// Per-tone styling: icon colour, number-badge ring, and the thin accent bar that
// carries the pipeline's meaning (indigo = agents, amber = conflict, emerald =
// human / cleared).
const TONE: Record<Tone, { icon: string; ring: string; bar: string; glow: string }> = {
  neutral: { icon: 'text-faint', ring: 'ring-border-strong', bar: 'bg-faint/50', glow: '' },
  agent: { icon: 'text-accent', ring: 'ring-accent/40', bar: 'bg-accent', glow: 'shadow-[0_0_24px_-12px_rgb(99_102_241/0.8)]' },
  conflict: { icon: 'text-warn', ring: 'ring-warn/40', bar: 'bg-warn', glow: 'shadow-[0_0_24px_-12px_rgb(251_191_36/0.8)]' },
  human: { icon: 'text-human', ring: 'ring-human/40', bar: 'bg-human', glow: 'shadow-[0_0_24px_-12px_rgb(52_211_153/0.8)]' },
  verdict: { icon: 'text-human', ring: 'ring-human/50', bar: 'bg-gradient-to-r from-human to-accent', glow: 'shadow-[0_0_28px_-12px_rgb(52_211_153/0.9)]' },
};

// 1.6px line icons, matching the sidebar's quiet hand-drawn set (no icon dep).
const svg = (path: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
    {path}
  </svg>
);

const ICON = {
  upload: svg(<><path d="M12 16V4m0 0L8 8m4-4 4 4" /><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></>),
  eye: svg(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>),
  agents: svg(<><circle cx="6" cy="7" r="2.4" /><circle cx="18" cy="7" r="2.4" /><circle cx="12" cy="17" r="2.4" /><path d="M7.6 8.7 11 15m6-6.3L13 15" /></>),
  debate: svg(<><path d="M4 5h10a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H8l-4 3z" /><path d="M18 9h2a0 0 0 0 1 0 0v9l-3-2h-5" /></>),
  loop: svg(<><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></>),
  gavel: svg(<><path d="M14 4 8 10m6-6 3 3-6 6-3-3m0 0L4 18l2 2 7.5-7.5" /><path d="M13 21h8" /></>),
  layers: svg(<><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>),
  check: svg(<><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>),
};

const SIMPLE: Step[] = [
  {
    n: '01',
    title: 'Submit your campaign',
    desc: 'Drop in your videos, posts, images and banners, grouped by advertisement.',
    tone: 'neutral',
    icon: ICON.upload,
  },
  {
    n: '02',
    title: 'Agents review & debate',
    desc: 'Specialist agents check every market at once, then negotiate the conflicts between them.',
    tone: 'agent',
    icon: ICON.agents,
  },
  {
    n: '03',
    title: 'Get the final verdict',
    desc: 'One clear call per region: publish, adapt the copy, or escalate to a human.',
    tone: 'verdict',
    icon: ICON.check,
  },
];

const FULL: Step[] = [
  {
    n: '01',
    title: 'Submit content',
    desc: 'A campaign holds advertisements; each ad holds materials (video, post, image, banner).',
    tone: 'neutral',
    icon: ICON.layers,
  },
  {
    n: '02',
    title: 'Perception',
    desc: 'Agents watch the video (transcript) and read each image: keyframes, on-screen text, the claims being made.',
    tone: 'agent',
    icon: ICON.eye,
  },
  {
    n: '03',
    title: 'Pods deliberate',
    desc: 'Three pods (Claims, Regulatory, Brand) each perceive the media and review it against their own mandate, all at once.',
    tone: 'agent',
    icon: ICON.agents,
  },
  {
    n: '04',
    title: 'Regions debate',
    desc: 'Competing objectives collide. Regions rebut each other (hold or concede), then the pods file their findings to the board.',
    tone: 'conflict',
    icon: ICON.debate,
  },
  {
    n: '05',
    title: 'Board reconciles',
    desc: 'A Mediator brokers cross-pod conflicts and a Risk Adjudicator scores the board; one remediation recommit fixes what it can, then a deadlock goes to a human.',
    tone: 'human',
    icon: ICON.loop,
  },
  {
    n: '06',
    title: 'Verdict & rollup',
    desc: 'A per-material, per-region decision, rolled up across the whole campaign.',
    tone: 'verdict',
    icon: ICON.gavel,
  },
];

function StepCard({ step, index }: { step: Step; index: number }) {
  const tone = TONE[step.tone];
  return (
    <div
      className={`rise surface relative flex flex-1 flex-col overflow-hidden rounded-2xl p-5 ${tone.glow}`}
      style={{ '--d': `${index * 90}ms` } as CSSProperties}
    >
      <span className={`absolute inset-x-0 top-0 h-[3px] ${tone.bar}`} aria-hidden />
      <div className="flex items-center justify-between">
        <span className={`${tone.icon}`}>{step.icon}</span>
        <span className={`font-mono text-[11px] font-semibold tracking-wider text-faint`}>{step.n}</span>
      </div>
      <h3 className="mt-3 font-display text-xl leading-tight text-fg">{step.title}</h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{step.desc}</p>
    </div>
  );
}

// The connector between steps: a chevron pointing along the flow (right on the
// desktop row, down when the steps stack on mobile).
function Connector() {
  return (
    <div className="flex shrink-0 items-center justify-center py-1 lg:px-1.5" aria-hidden>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 rotate-90 text-faint lg:rotate-0">
        <path d="m9 6 6 6-6 6" />
      </svg>
    </div>
  );
}

export function WorkflowDiagram() {
  const [mode, setMode] = useState<'simple' | 'full'>('simple');
  const steps = mode === 'simple' ? SIMPLE : FULL;

  return (
    <div className="w-full">
      {/* Toggle: two views of the same process. */}
      <div className="mb-7 flex justify-center">
        <div className="glass inline-flex items-center gap-1 rounded-full p-1">
          {(['simple', 'full'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200 ${
                mode === m ? 'bg-surface-3 text-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]' : 'text-muted hover:text-fg'
              }`}
            >
              {m === 'simple' ? 'Simple' : 'Full pipeline'}
            </button>
          ))}
        </div>
      </div>

      {/* The flow. A single row on desktop, a stack on mobile, with connectors. */}
      <div className="flex flex-col items-stretch gap-1 lg:flex-row lg:gap-0">
        {steps.map((step, i) => (
          <Fragment key={`${mode}-${step.n}`}>
            <StepCard step={step} index={i} />
            {i < steps.length - 1 ? <Connector /> : null}
          </Fragment>
        ))}
      </div>

      {/* One-line takeaway that names the thing that makes this different. */}
      <p className="mt-7 text-center text-sm text-muted">
        {mode === 'simple' ? (
          <>The agents do not just run checks in a line. They have competing goals and have to <span className="text-fg">agree on a tradeoff</span>.</>
        ) : (
          <>The originality lives in step 4: a genuine <span className="text-warn">conflict</span> between markets, reconciled, then escalated to a human only on a real deadlock.</>
        )}
      </p>
    </div>
  );
}
