import { useState } from 'react';

type EscalationVariant = 'panel' | 'diagram';

interface EscalationDecisionProps {
  text: string;
  // When undefined, the card renders read-only (history / resolved).
  onSubmit?: (decision: string) => Promise<void> | void;
  recordedDecision?: string;
  // 'panel' (default) is the standalone light card; 'diagram' is the compact
  // dark-canvas form embedded inside the Compliance lead node.
  variant?: EscalationVariant;
}

export function EscalationDecision({
  text,
  onSubmit,
  recordedDecision,
  variant = 'panel',
}: EscalationDecisionProps) {
  const [decision, setDecision] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolved = Boolean(recordedDecision);
  const canSubmit = Boolean(onSubmit) && !resolved;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!onSubmit || !decision.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(decision.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit decision.');
    } finally {
      setSubmitting(false);
    }
  }

  // Quick-decision presets so a reviewer can resolve a gray area in one click.
  const presets = ['approve', 'reject', 'request changes'];

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
        ) : canSubmit ? (
          <form onSubmit={handleSubmit} className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {presets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setDecision(preset)}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset transition ${
                    decision === preset
                      ? 'bg-emerald-500/30 text-emerald-50 ring-emerald-300/60'
                      : 'bg-slate-800/80 text-slate-300 ring-slate-600/60 hover:text-emerald-100'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
            <textarea
              value={decision}
              onChange={(event) => setDecision(event.target.value)}
              placeholder="Decision + note (e.g. approve with EFSA disclosure)."
              rows={2}
              className="w-full rounded-md border border-slate-600/70 bg-slate-900/70 p-2 text-[11px] text-slate-100 placeholder:text-slate-500 focus:border-emerald-400/60 focus:outline-none focus:ring-1 focus:ring-emerald-400/60"
            />
            {error ? <p className="text-[11px] text-red-300">{error}</p> : null}
            <button
              type="submit"
              disabled={submitting || !decision.trim()}
              className="inline-flex w-full items-center justify-center rounded-md bg-emerald-500 px-3 py-1.5 text-[11px] font-semibold text-emerald-950 shadow-sm transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Submitting.' : 'Record decision'}
            </button>
          </form>
        ) : (
          <p className="text-[11px] text-slate-400">Awaiting a decision.</p>
        )}
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
      ) : canSubmit ? (
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <textarea
            value={decision}
            onChange={(event) => setDecision(event.target.value)}
            placeholder="Enter your decision (for example: approve with EFSA disclosure, or reject)."
            rows={3}
            className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-800 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            type="submit"
            disabled={submitting || !decision.trim()}
            className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Submitting.' : 'Submit decision'}
          </button>
        </form>
      ) : (
        <p className="mt-4 text-sm text-slate-500">Awaiting a decision.</p>
      )}
    </section>
  );
}
