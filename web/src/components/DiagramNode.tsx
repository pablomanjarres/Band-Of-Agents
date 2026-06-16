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
  context: 'border-border-strong bg-surface-2 text-fg',
  ai: 'border-accent/40 bg-accent/[0.08] text-fg',
  human: 'border-human/40 bg-human/[0.07] text-fg',
  outcome: 'border-border-strong bg-surface-2 text-fg',
};

// Glow ring colour when a node is "active" (mid-flight).
const VARIANT_ACTIVE_RING: Record<NodeVariant, string> = {
  context: 'ring-muted/40',
  ai: 'ring-accent/60',
  human: 'ring-human/60',
  outcome: 'ring-muted/40',
};

// Verdict palette overrides an agent node once a decision lands.
const VERDICT_STYLE: Record<VerdictDecision, string> = {
  publish: 'border-human/60 bg-human/[0.1] text-fg',
  adapt: 'border-warn/60 bg-warn/[0.1] text-fg',
  escalate: 'border-danger/60 bg-danger/[0.1] text-fg',
};

const SUBTITLE_TONE: Record<NodeVariant, string> = {
  context: 'text-faint',
  ai: 'text-accent/80',
  human: 'text-human/80',
  outcome: 'text-faint',
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
        'relative rounded-xl border px-3 py-2.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.05),0_10px_30px_-12px_rgb(0_0_0/0.8)] backdrop-blur-sm transition-all duration-500',
        palette,
        dimmed ? 'opacity-40 saturate-[0.6]' : 'opacity-100',
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
