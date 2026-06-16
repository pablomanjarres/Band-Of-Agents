import { useState } from 'react';
import { transcribeMaterial } from '../api';
import { REGION_ORDER, type BoardState, type RegionState, type RegionStatus } from '../boardState';
import type { Material, MaterialKind } from '../types';

interface MaterialDetailProps {
  material: Material;
  /** The material's live/last review lane, if a review has run. */
  board?: BoardState;
  /** Campaign + advertisement this material lives under (enables manual transcribe). */
  campaignId?: string;
  advertisementId?: string;
  onClose: () => void;
  /** Open the agents' debate (PipelineDiagram) for this material. */
  onViewDebate?: () => void;
  /** True while the material is in a review (enables "View debate"). */
  reviewed?: boolean;
  /** Re-fetch the campaign after a manual transcribe so the transcript shows. */
  onTranscribed?: () => void | Promise<void>;
}

const KIND_TONE: Record<MaterialKind, string> = {
  video: 'bg-violet-500/15 text-violet-300 ring-1 ring-inset ring-violet-400/30',
  post: 'bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-400/30',
  image: 'bg-teal-500/15 text-teal-300 ring-1 ring-inset ring-teal-400/30',
  banner: 'bg-warn/15 text-warn ring-1 ring-inset ring-warn/30',
};

const STATUS_TONE: Record<RegionStatus, { dot: string; text: string; label: string }> = {
  reviewing: { dot: 'animate-pulse-soft bg-warn', text: 'text-warn', label: 'reviewing' },
  publish: { dot: 'bg-human', text: 'text-human', label: 'publish' },
  adapt: { dot: 'bg-warn', text: 'text-warn', label: 'adapt' },
  escalate: { dot: 'bg-danger', text: 'text-danger', label: 'escalate' },
};

/**
 * The material slide-over: clicking a material shows THE MATERIAL (its media, copy,
 * claim, perception artifacts, and per-region verdicts), not the agent diagram. The
 * agents' debate is one explicit click away via "View the agents' debate".
 */
export function MaterialDetail({ material, board, campaignId, advertisementId, onClose, onViewDebate, reviewed, onTranscribed }: MaterialDetailProps) {
  const frames = material.perception?.frames ?? [];
  const poster = frames[0] ?? material.imageUrl;
  const regions: RegionState[] = board
    ? REGION_ORDER.map((r) => board.regions[r]).filter((r): r is RegionState => Boolean(r))
    : [];

  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);

  const transcript = material.perception?.transcript?.trim();
  const hasTranscript = Boolean(transcript);
  // A manual transcribe is possible only for a hosted video with the ids we need to
  // re-post its bytes and refresh the campaign.
  const canTranscribe = Boolean(material.videoUrl && campaignId && onTranscribed);

  async function handleTranscribe() {
    if (!material.videoUrl || !campaignId) return;
    setTranscribing(true);
    setTranscribeError(null);
    try {
      await transcribeMaterial({
        campaignId,
        ...(advertisementId ? { advertisementId } : {}),
        materialId: material.id,
        videoUrl: material.videoUrl,
      });
      await onTranscribed?.();
    } catch (err) {
      setTranscribeError(err instanceof Error ? err.message : 'Transcription failed.');
    } finally {
      setTranscribing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-bg/60 backdrop-blur-sm" />
      <aside className="relative z-10 flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-border bg-surface shadow-2xl">
        <header className="glass sticky top-0 flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${KIND_TONE[material.kind]}`}>
                {material.kind}
              </span>
              <h2 className="truncate font-display text-xl text-fg">{material.name ?? material.id}</h2>
            </div>
            <p className="mt-0.5 font-mono text-[11px] text-faint">
              {material.channel}
              {material.markets.length > 0 ? ` · ${material.markets.join(', ')}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost px-2.5 py-1 text-xs">
            Close
          </button>
        </header>

        <div className="space-y-5 px-5 py-5">
          {/* Media preview: a real player for video, the image otherwise. */}
          {material.videoUrl ? (
            <video src={material.videoUrl} controls poster={poster} className="aspect-video w-full rounded-xl bg-bg object-cover" />
          ) : poster ? (
            <img src={poster} alt={material.name ?? material.id} className="aspect-video w-full rounded-xl bg-bg-soft object-cover" />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded-xl bg-bg-soft text-xs text-faint">
              No media attached
            </div>
          )}

          {frames.length > 1 ? (
            <div className="flex gap-2 overflow-x-auto">
              {frames.map((f, i) => (
                <img key={f + i} src={f} alt={`frame ${i + 1}`} className="h-12 w-20 shrink-0 rounded-md border border-border object-cover" />
              ))}
            </div>
          ) : null}

          <Field label="Copy">{material.copy || <span className="text-faint">no copy</span>}</Field>
          <Field label="Claim">{material.claim || <span className="text-faint">no claim</span>}</Field>

          {/* Transcript: captured at upload time for videos. Always shown when present;
              an empty state + manual Transcribe for a video that has no transcript yet. */}
          {hasTranscript || material.videoUrl ? (
            <div className="space-y-2 rounded-xl border border-violet-400/25 bg-violet-500/[0.06] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-violet-300/80">Transcript</p>
                {!hasTranscript && canTranscribe ? (
                  <button
                    type="button"
                    onClick={handleTranscribe}
                    disabled={transcribing}
                    className="btn border border-violet-400/30 bg-violet-500/10 px-2.5 py-1 text-xs text-violet-200 hover:bg-violet-500/15 disabled:opacity-60"
                  >
                    {transcribing ? 'Transcribing…' : 'Transcribe'}
                  </button>
                ) : null}
              </div>
              {hasTranscript ? (
                <div className="text-sm leading-relaxed text-fg/90">{transcript}</div>
              ) : transcribing ? (
                <p className="inline-flex items-center gap-1.5 text-xs text-violet-200/80">
                  <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-violet-400" />
                  Transcribing the audio…
                </p>
              ) : (
                <p className="text-xs text-faint">
                  No transcript yet.{' '}
                  {canTranscribe
                    ? 'Click Transcribe to extract the audio, or run a review.'
                    : 'Run a review to perceive this video.'}
                </p>
              )}
              {transcribeError ? <p className="text-xs text-danger">{transcribeError}</p> : null}
            </div>
          ) : null}

          {/* Other perception artifacts produced during a review (transcript shown above). */}
          {material.perception &&
          (material.perception.visualDescription ||
            material.perception.onScreenText ||
            (material.perception.detectedClaims && material.perception.detectedClaims.length > 0)) ? (
            <div className="space-y-2 rounded-xl border border-violet-400/25 bg-violet-500/[0.06] p-3">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-violet-300/80">What the agents perceived</p>
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
              <p className="eyebrow">Per-region verdicts</p>
              {reviewed && onViewDebate ? (
                <button type="button" onClick={onViewDebate} className="rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/15">
                  View the agents&apos; debate
                </button>
              ) : null}
            </div>
            {regions.length === 0 ? (
              <p className="rounded-lg border border-border bg-bg-soft/60 px-3 py-2 text-xs text-muted">
                Not reviewed yet. Run a campaign review to see per-region verdicts.
              </p>
            ) : (
              <ul className="space-y-2">
                {regions.map((rs) => {
                  const tone = STATUS_TONE[rs.status];
                  return (
                    <li key={rs.region} className="surface rounded-xl p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-sm font-semibold uppercase tracking-wide text-fg">{rs.region}</span>
                        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${tone.text}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} /> {tone.label}
                          {rs.findings.length > 0 ? <span className="text-faint">· {rs.findings.length} finding{rs.findings.length === 1 ? '' : 's'}</span> : null}
                        </span>
                      </div>
                      {rs.rationale ? <p className="mt-1 text-xs text-muted">{rs.rationale}</p> : null}
                      {rs.findings.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {rs.findings.map((f, i) => (
                            <li key={i} className="rounded-md bg-bg-soft/60 px-2 py-1 text-xs text-muted">
                              <span className={`font-semibold ${f.severity === 'block' ? 'text-danger' : f.severity === 'warn' ? 'text-warn' : 'text-faint'}`}>
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
      <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-faint">{label}</p>
      <div className="mt-1 text-sm leading-relaxed text-fg/90">{children}</div>
    </div>
  );
}
