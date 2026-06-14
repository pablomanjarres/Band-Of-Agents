import type { ReactNode, Ref } from 'react';
import type { NodeActivity, NodeVariant } from '../pipeline';
import type { VerdictDecision } from '../types';

interface DiagramNodeProps {
  title: string;
  subtitle?: string;
  variant: NodeVariant;
  activity: NodeActivity;
  // When present, an agent node is coloured by its verdict instead of variant.
  verdict?: VerdictDecision;
  badge?: ReactNode;
  children?: ReactNode;
  nodeRef?: Ref<HTMLDivElement>;
  className?: string;
}

// Base palette per visual family on the dark canvas (idle / dimmed look).
const VARIANT_BASE: Record<NodeVariant, string> = {
  context: 'border-slate-600/70 bg-slate-800/70 text-slate-200',
  ai: 'border-indigo-500/40 bg-indigo-950/50 text-indigo-100',
  human: 'border-emerald-500/40 bg-emerald-950/40 text-emerald-100',
  outcome: 'border-slate-600/60 bg-slate-800/60 text-slate-200',
};

// Glow ring colour when a node is "active" (mid-flight).
const VARIANT_ACTIVE_RING: Record<NodeVariant, string> = {
  context: 'ring-slate-400/40',
  ai: 'ring-indigo-400/60',
  human: 'ring-emerald-400/60',
  outcome: 'ring-slate-400/40',
};

// Verdict palette overrides an agent node once a decision lands.
const VERDICT_STYLE: Record<VerdictDecision, string> = {
  publish: 'border-emerald-400/70 bg-emerald-950/50 text-emerald-100',
  adapt: 'border-amber-400/70 bg-amber-950/50 text-amber-100',
  escalate: 'border-red-400/70 bg-red-950/50 text-red-100',
};

const SUBTITLE_TONE: Record<NodeVariant, string> = {
  context: 'text-slate-400',
  ai: 'text-indigo-300/80',
  human: 'text-emerald-300/80',
  outcome: 'text-slate-400',
};

export function DiagramNode({
  title,
  subtitle,
  variant,
  activity,
  verdict,
  badge,
  children,
  nodeRef,
  className,
}: DiagramNodeProps) {
  const palette = verdict ? VERDICT_STYLE[verdict] : VARIANT_BASE[variant];
  const dimmed = activity === 'idle' && !verdict;
  const active = activity === 'active';

  return (
    <div
      ref={nodeRef}
      className={[
        'relative rounded-xl border px-3 py-2 shadow-lg backdrop-blur-sm transition-all duration-500',
        palette,
        dimmed ? 'opacity-45 saturate-50' : 'opacity-100',
        active ? `ring-2 ${VARIANT_ACTIVE_RING[variant]}` : 'ring-0',
        className ?? '',
      ].join(' ')}
    >
      {active ? (
        <span
          aria-hidden
          className={`pointer-events-none absolute -inset-px rounded-xl ${VARIANT_ACTIVE_RING[variant]} animate-node-glow ring-2`}
        />
      ) : null}

      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">{title}</p>
          {subtitle ? (
            <p className={`mt-0.5 truncate text-[11px] leading-tight ${SUBTITLE_TONE[variant]}`}>
              {subtitle}
            </p>
          ) : null}
        </div>
        {badge ? <div className="shrink-0">{badge}</div> : null}
      </div>

      {children ? <div className="relative mt-2">{children}</div> : null}
    </div>
  );
}
