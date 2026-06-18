import { useState } from 'react';
import { transcribeMaterial } from '../api';
import { REGION_ORDER, type BoardState, type RegionState, type RegionStatus } from '../boardState';
import type { Material, MaterialKind } from '../types';

/** The authored fields a user can edit on a material (not the agent outputs). */
export interface MaterialEditPatch {
  name?: string;
  kind?: MaterialKind;
  channel?: string;
  markets?: string[];
  copy?: string;
  claim?: string;
}

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
  /** Persist edits to this material's authored fields. Enables the Edit button. */
  onSave?: (patch: MaterialEditPatch) => void | Promise<void>;
}

const KIND_TONE: Record<MaterialKind, string> = {
  video: 'bg-violet-500/15 text-violet-300 ring-1 ring-inset ring-violet-400/30',
  post: 'bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-400/30',
  image: 'bg-teal-500/15 text-teal-300 ring-1 ring-inset ring-teal-400/30',
  banner: 'bg-warn/15 text-warn ring-1 ring-inset ring-warn/30',
};

const MATERIAL_KINDS: MaterialKind[] = ['video', 'post', 'image', 'banner'];
const MARKET_OPTIONS = ['US', 'EU', 'LATAM'] as const;

// A region is "not validated" until an agent rules on it, then it lights up with
// the verdict (publish / adapt / escalate). The not-validated state is dim and
// static, NOT a pulsing "reviewing" (nothing is running until a review starts).
const STATUS_TONE: Record<RegionStatus, { dot: string; text: string; label: string }> = {
  reviewing: { dot: 'bg-faint', text: 'text-muted', label: 'not validated' },
  publish: { dot: 'bg-human', text: 'text-human', label: 'validated · publish' },
  adapt: { dot: 'bg-warn', text: 'text-warn', label: 'validated · adapt' },
  escalate: { dot: 'bg-danger', text: 'text-danger', label: 'validated · escalate' },
};

const labelClass = 'block font-mono text-[10px] font-medium uppercase tracking-wider text-faint';
const inputClass =
  'mt-1.5 w-full rounded-xl border border-border-strong bg-bg-soft/70 p-2 text-sm text-fg placeholder:text-faint transition-colors focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/25';

/**
 * The material slide-over: clicking a material shows THE MATERIAL (its media, copy,
 * claim, perception artifacts, and per-region verdicts), not the agent diagram. The
 * authored fields are editable in place; the agents' debate is one click away.
 */
export function MaterialDetail({ material, board, campaignId, advertisementId, onClose, onViewDebate, reviewed, onTranscribed, onSave }: MaterialDetailProps) {
  const frames = material.perception?.frames ?? [];
  const poster = frames[0] ?? material.imageUrl;
  const regions: RegionState[] = board
    ? REGION_ORDER.map((r) => board.regions[r]).filter((r): r is RegionState => Boolean(r))
    : [];
  // Always show the four regions: dim "not validated" until an agent rules on each,
  // then the row lights up with that region's verdict.
  const shownRegions: RegionState[] =
    regions.length > 0 ? regions : REGION_ORDER.map((r) => ({ region: r, status: 'reviewing', findings: [], blocking: 0 }));

  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  // The stored video file may be unavailable (e.g. lost on a redeploy). Rather than
  // show the browser's broken-media icon, <video onError> flips this and we fall back
  // to a sampled frame / a clean "preview unavailable" card.
  const [videoFailed, setVideoFailed] = useState(false);

  // Edit mode for the authored fields. Seeded from the material; the parent keys
  // this component by material id, so state resets when a different material opens.
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [name, setName] = useState(material.name ?? '');
  const [kind, setKind] = useState<MaterialKind>(material.kind);
  const [channel, setChannel] = useState(material.channel);
  const [copyText, setCopyText] = useState(material.copy);
  const [claimText, setClaimText] = useState(material.claim);
  const [markets, setMarkets] = useState<string[]>(material.markets);

  const transcript = material.perception?.transcript?.trim();
  const hasTranscript = Boolean(transcript);
  const canTranscribe = Boolean(material.videoUrl && campaignId && onTranscribed);

  function toggleMarket(market: string) {
    setMarkets((prev) => (prev.includes(market) ? prev.filter((m) => m !== market) : [...prev, market]));
  }

  function cancelEdit() {
    setName(material.name ?? '');
    setKind(material.kind);
    setChannel(material.channel);
    setCopyText(material.copy);
    setClaimText(material.claim);
    setMarkets(material.markets);
    setSaveError(null);
    setEditing(false);
  }

  async function handleSave() {
    if (!onSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({ name: name.trim() || material.id, kind, channel: channel.trim(), markets, copy: copyText, claim: claimText });
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save the material.');
    } finally {
      setSaving(false);
    }
  }

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
          <div className="flex shrink-0 items-center gap-2">
            {onSave && !editing ? (
              <button type="button" onClick={() => setEditing(true)} className="btn btn-ghost px-2.5 py-1 text-xs">
                Edit
              </button>
            ) : null}
            <button type="button" onClick={onClose} className="btn btn-ghost px-2.5 py-1 text-xs">
              Close
            </button>
          </div>
        </header>

        <div className="space-y-5 px-5 py-5">
          {/* Media preview: a real player for a playable video, otherwise a sampled
              frame, otherwise a clean "preview unavailable" / "no media" card. The
              video's onError flips to the fallback so a missing file never shows the
              browser's broken-media icon. */}
          {material.videoUrl && !videoFailed ? (
            <video
              src={material.videoUrl}
              controls
              poster={poster}
              onError={() => setVideoFailed(true)}
              className="aspect-video w-full rounded-xl bg-bg object-cover"
            />
          ) : poster ? (
            <div className="relative">
              <img src={poster} alt={material.name ?? material.id} className="aspect-video w-full rounded-xl bg-bg-soft object-cover" />
              {videoFailed ? (
                <span className="absolute bottom-2 left-2 rounded-md bg-bg/80 px-2 py-1 text-[10px] font-medium text-muted backdrop-blur-sm">
                  Video preview unavailable, showing a sampled frame
                </span>
              ) : null}
            </div>
          ) : videoFailed ? (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-xl bg-bg-soft px-4 text-center">
              <p className="text-sm font-medium text-muted">Video preview unavailable</p>
              <p className="text-xs text-faint">The stored file could not be loaded. The review still works from the details below.</p>
            </div>
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

          {/* Authored fields: read-only, or an inline editor when editing. */}
          {editing ? (
            <div className="space-y-3 rounded-2xl border border-accent/25 bg-accent/[0.04] p-4">
              <p className="eyebrow text-accent/80">Editing this material</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="md-name">Name</label>
                  <input id="md-name" type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder={material.id} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="md-kind">Kind</label>
                  <select id="md-kind" value={kind} onChange={(e) => setKind(e.target.value as MaterialKind)} className={inputClass}>
                    {MATERIAL_KINDS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={labelClass} htmlFor="md-channel">Channel</label>
                <input id="md-channel" type="text" value={channel} onChange={(e) => setChannel(e.target.value)} className={inputClass} />
              </div>
              <div>
                <span className={labelClass}>Markets</span>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {MARKET_OPTIONS.map((market) => {
                    const checked = markets.includes(market);
                    return (
                      <label
                        key={market}
                        className={[
                          'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all',
                          checked ? 'border-accent/50 bg-accent/10 text-accent' : 'border-border-strong bg-bg-soft/60 text-muted hover:text-fg',
                        ].join(' ')}
                      >
                        <input type="checkbox" checked={checked} onChange={() => toggleMarket(market)} className="h-3.5 w-3.5 rounded border-border-strong bg-bg-soft text-accent-strong focus:ring-accent/40 focus:ring-offset-0" />
                        {market}
                      </label>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className={labelClass} htmlFor="md-copy">Copy</label>
                <textarea id="md-copy" value={copyText} onChange={(e) => setCopyText(e.target.value)} rows={3} className={inputClass} placeholder="The marketing copy for this material." />
              </div>
              <div>
                <label className={labelClass} htmlFor="md-claim">Claim</label>
                <input id="md-claim" type="text" value={claimText} onChange={(e) => setClaimText(e.target.value)} className={inputClass} placeholder="The central claim this material makes." />
              </div>
              {saveError ? <p className="text-xs text-danger">{saveError}</p> : null}
              <div className="flex items-center gap-2">
                <button type="button" onClick={handleSave} disabled={saving} className="btn btn-primary px-4 py-2 text-sm">
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
                <button type="button" onClick={cancelEdit} disabled={saving} className="btn btn-ghost px-4 py-2 text-sm">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <Field label="Copy">{material.copy || <span className="text-faint">no copy</span>}</Field>
              <Field label="Claim">{material.claim || <span className="text-faint">no claim</span>}</Field>
            </>
          )}

          {/* Transcript: captured at upload time for videos. The transcript and the
              perception below are produced by the agents, so they are not hand-edited
              here; re-run Transcribe (or a review) to refresh them. */}
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
                  {canTranscribe ? 'Click Transcribe to extract the audio, or run a review.' : 'Run a review to perceive this video.'}
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

          {/* Per-region validation for THIS material: dim until an agent rules, then
              it lights up with the verdict. */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="eyebrow">Per-region validation</p>
              {reviewed && onViewDebate ? (
                <button type="button" onClick={onViewDebate} className="rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/15">
                  View the agents&apos; debate
                </button>
              ) : null}
            </div>
            <ul className="space-y-2">
              {shownRegions.map((rs) => {
                const tone = STATUS_TONE[rs.status];
                const validated = rs.status !== 'reviewing';
                return (
                  <li key={rs.region} className={`surface rounded-xl p-3 transition-opacity ${validated ? '' : 'opacity-70'}`}>
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
            <p className="mt-2 text-xs text-faint">Run a review to have the agents validate each region.</p>
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
