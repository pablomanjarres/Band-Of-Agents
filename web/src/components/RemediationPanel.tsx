import type { Remediation } from '../boardState';

export function RemediationPanel({ remediation }: { remediation: Remediation }) {
  return (
    <section className="rounded-2xl border border-human/30 bg-human/[0.06] p-5 shadow-[inset_0_1px_0_rgb(255_255_255/0.04),0_0_32px_-16px_rgb(52_211_153/0.5)]">
      <div className="flex items-center justify-between">
        <p className="eyebrow text-human/70">Remediation</p>
        <span className="rounded-full bg-human/15 px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-human ring-1 ring-inset ring-human/30">
          {remediation.region}
        </span>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[180px_1fr]">
        {remediation.imageUrl ? (
          <img
            src={remediation.imageUrl}
            alt={`Revised creative for ${remediation.region}`}
            className="h-44 w-44 rounded-xl border border-human/25 object-cover"
          />
        ) : (
          <div className="flex h-44 w-44 items-center justify-center rounded-xl border border-dashed border-human/25 bg-bg-soft/60 text-xs text-faint">
            No image
          </div>
        )}

        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-human/70">
            Rewritten copy
          </p>
          <blockquote className="mt-2 rounded-xl border border-human/15 bg-bg-soft/60 p-3 text-sm leading-relaxed text-fg/90">
            {remediation.copy}
          </blockquote>
          {remediation.markets.length > 0 ? (
            <p className="mt-3 text-xs text-human/80">
              Markets: {remediation.markets.join(', ')}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
