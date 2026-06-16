import { REGION_ORDER, type BoardState, type RegionState, type RegionStatus } from '../boardState';
import type { Material, MaterialKind } from '../types';

interface MaterialDetailProps {
  material: Material;
  /** The material's live/last review lane, if a review has run. */
  board?: BoardState;
  onClose: () => void;
  /** Open the agents' debate (PipelineDiagram) for this material. */
  onViewDebate?: () => void;
  /** True while the material is in a review (enables "View debate"). */
  reviewed?: boolean;
}

const KIND_TONE: Record<MaterialKind, string> = {
  video: 'bg-violet-100 text-violet-700',
  post: 'bg-sky-100 text-sky-700',
  image: 'bg-teal-100 text-teal-700',
  banner: 'bg-amber-100 text-amber-700',
};

const STATUS_TONE: Record<RegionStatus, { dot: string; text: string; label: string }> = {
  reviewing: { dot: 'animate-pulse-soft bg-amber-400', text: 'text-amber-700', label: 'reviewing' },
  publish: { dot: 'bg-emerald-500', text: 'text-emerald-700', label: 'publish' },
  adapt: { dot: 'bg-amber-500', text: 'text-amber-700', label: 'adapt' },
  escalate: { dot: 'bg-red-500', text: 'text-red-700', label: 'escalate' },
};

/**
 * The material slide-over: clicking a material shows THE MATERIAL (its media, copy,
 * claim, perception artifacts, and per-region verdicts), not the agent diagram. The
 * agents' debate is one explicit click away via "View the agents' debate".
 */
export function MaterialDetail({ material, board, onClose, onViewDebate, reviewed }: MaterialDetailProps) {
  const frames = material.perception?.frames ?? [];
  const poster = frames[0] ?? material.imageUrl;
  const regions: RegionState[] = board
    ? REGION_ORDER.map((r) => board.regions[r]).filter((r): r is RegionState => Boolean(r))
    : [];

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" />
      <aside className="relative z-10 flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white shadow-2xl">
        <header className="sticky top-0 flex items-start justify-between gap-3 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${KIND_TONE[material.kind]}`}>
                {material.kind}
              </span>
              <h2 className="truncate text-base font-bold text-slate-900">{material.name ?? material.id}</h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              {material.channel}
              {material.markets.length > 0 ? ` · ${material.markets.join(', ')}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-slate-50">
            Close
          </button>
        </header>

        <div className="space-y-5 px-5 py-5">
          {/* Media preview: a real player for video, the image otherwise. */}
          {material.videoUrl ? (
            <video src={material.videoUrl} controls poster={poster} className="aspect-video w-full rounded-xl bg-slate-900 object-cover" />
          ) : poster ? (
            <img src={poster} alt={material.name ?? material.id} className="aspect-video w-full rounded-xl bg-slate-100 object-cover" />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded-xl bg-slate-100 text-xs text-slate-400">
              No media attached
            </div>
          )}

          {frames.length > 1 ? (
            <div className="flex gap-2 overflow-x-auto">
              {frames.map((f, i) => (
                <img key={f + i} src={f} alt={`frame ${i + 1}`} className="h-12 w-20 shrink-0 rounded-md border border-slate-200 object-cover" />
              ))}
            </div>
          ) : null}

          <Field label="Copy">{material.copy || <span className="text-slate-400">no copy</span>}</Field>
          <Field label="Claim">{material.claim || <span className="text-slate-400">no claim</span>}</Field>

          {material.perception ? (
            <div className="space-y-2 rounded-xl border border-violet-200 bg-violet-50/50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-600">What the agents perceived</p>
              {material.perception.transcript ? <Field label="Transcript">{material.perception.transcript}</Field> : null}
              {material.perception.visualDescription ? <Field label="Visual description">{material.perception.visualDescription}</Field> : null}
              {material.perception.onScreenText ? <Field label="On-screen text">{material.perception.onScreenText}</Field> : null}
              {material.perception.detectedClaims && material.perception.detectedClaims.length > 0 ? (
                <Field label="Detected claims">
                  <ul className="list-inside list-disc">
                    {material.perception.detectedClaims.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </Field>
              ) : null}
            </div>
          ) : null}

          {/* Per-region verdicts for THIS material. */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Per-region verdicts</p>
              {reviewed && onViewDebate ? (
                <button type="button" onClick={onViewDebate} className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100">
                  View the agents&apos; debate
                </button>
              ) : null}
            </div>
            {regions.length === 0 ? (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                Not reviewed yet. Run a campaign review to see per-region verdicts.
              </p>
            ) : (
              <ul className="space-y-2">
                {regions.map((rs) => {
                  const tone = STATUS_TONE[rs.status];
                  return (
                    <li key={rs.region} className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-slate-800">{rs.region}</span>
                        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${tone.text}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} /> {tone.label}
                          {rs.findings.length > 0 ? <span className="text-slate-400">· {rs.findings.length} finding{rs.findings.length === 1 ? '' : 's'}</span> : null}
                        </span>
                      </div>
                      {rs.rationale ? <p className="mt-1 text-xs text-slate-500">{rs.rationale}</p> : null}
                      {rs.findings.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {rs.findings.map((f, i) => (
                            <li key={i} className="rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-600">
                              <span className={`font-semibold ${f.severity === 'block' ? 'text-red-600' : f.severity === 'warn' ? 'text-amber-600' : 'text-slate-500'}`}>
                                [{f.severity}]
                              </span>{' '}
                              {f.rationale}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <div className="mt-0.5 text-sm leading-relaxed text-slate-700">{children}</div>
    </div>
  );
}
