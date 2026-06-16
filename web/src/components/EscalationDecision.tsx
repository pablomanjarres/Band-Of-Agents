type EscalationVariant = 'panel' | 'diagram';

interface EscalationDecisionProps {
  text: string;
  recordedDecision?: string;
  // 'panel' (default) is the standalone light card; 'diagram' is the compact
  // dark-canvas form embedded inside the Compliance lead node.
  variant?: EscalationVariant;
}

// The human rules INSIDE the band.ai room, not here. This card is informational:
// it shows the escalation reason and, once recorded, the decision the agents
// observed from band.ai. There are no controls to record a decision here.
export function EscalationDecision({
  text,
  recordedDecision,
  variant = 'panel',
}: EscalationDecisionProps) {
  const resolved = Boolean(recordedDecision);

  if (variant === 'diagram') {
    return (
      <div className="space-y-2">
        <p className="rounded-md border border-human/20 bg-bg-soft/70 p-2 text-[11px] leading-snug text-human/90">
          {text}
        </p>

        {resolved ? (
          <div className="rounded-md border border-human/40 bg-human/15 p-2 text-[11px] text-human">
            <span className="font-semibold">Recorded:</span> {recordedDecision}
          </div>
        ) : (
          <p className="text-[11px] text-faint">Awaiting a decision in the band.ai room.</p>
        )}

        <p className="text-[10px] text-faint">Decision is made in the band.ai room.</p>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-danger/30 bg-danger/[0.06] p-5 shadow-[inset_0_1px_0_rgb(255_255_255/0.04),0_0_32px_-16px_rgb(248_113_113/0.5)]">
      <p className="eyebrow text-danger/70">Escalation · human decision required</p>
      <p className="mt-2 text-sm text-fg/90">{text}</p>

      {resolved ? (
        <div className="mt-4 rounded-xl border border-human/30 bg-human/10 p-3 text-sm text-human">
          <span className="font-semibold">Recorded decision:</span> {recordedDecision}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">Awaiting a decision in the band.ai room.</p>
      )}

      <p className="mt-3 text-xs text-faint">Decision is made in the band.ai room.</p>
    </section>
  );
}
