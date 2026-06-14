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
        <p className="rounded-md border border-emerald-500/20 bg-slate-900/60 p-2 text-[11px] leading-snug text-emerald-100/90">
          {text}
        </p>

        {resolved ? (
          <div className="rounded-md border border-emerald-400/40 bg-emerald-500/15 p-2 text-[11px] text-emerald-100">
            <span className="font-semibold">Recorded:</span> {recordedDecision}
          </div>
        ) : (
          <p className="text-[11px] text-slate-400">Awaiting a decision in the band.ai room.</p>
        )}

        <p className="text-[10px] text-slate-500">Decision is made in the band.ai room.</p>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-red-200 bg-red-50/60 p-5 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-red-700">
        Escalation: human decision required
      </h2>
      <p className="mt-2 text-sm text-slate-700">{text}</p>

      {resolved ? (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <span className="font-semibold">Recorded decision:</span> {recordedDecision}
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">Awaiting a decision in the band.ai room.</p>
      )}

      <p className="mt-3 text-xs text-slate-400">Decision is made in the band.ai room.</p>
    </section>
  );
}
