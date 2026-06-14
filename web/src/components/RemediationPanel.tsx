import type { Remediation } from '../boardState';

export function RemediationPanel({ remediation }: { remediation: Remediation }) {
  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
          Remediation
        </h2>
        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
          {remediation.region}
        </span>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[180px_1fr]">
        {remediation.imageUrl ? (
          <img
            src={remediation.imageUrl}
            alt={`Revised creative for ${remediation.region}`}
            className="h-44 w-44 rounded-lg border border-emerald-200 object-cover"
          />
        ) : (
          <div className="flex h-44 w-44 items-center justify-center rounded-lg border border-dashed border-emerald-200 bg-white text-xs text-emerald-400">
            No image
          </div>
        )}

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
            Rewritten copy
          </p>
          <blockquote className="mt-2 rounded-lg border border-emerald-100 bg-white p-3 text-sm leading-relaxed text-slate-700">
            {remediation.copy}
          </blockquote>
          {remediation.markets.length > 0 ? (
            <p className="mt-3 text-xs text-emerald-700">
              Markets: {remediation.markets.join(', ')}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
