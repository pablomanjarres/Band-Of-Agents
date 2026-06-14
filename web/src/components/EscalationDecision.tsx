import { useState } from 'react';

interface EscalationDecisionProps {
  text: string;
  // When undefined, the card renders read-only (history / resolved).
  onSubmit?: (decision: string) => Promise<void> | void;
  recordedDecision?: string;
}

export function EscalationDecision({ text, onSubmit, recordedDecision }: EscalationDecisionProps) {
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
