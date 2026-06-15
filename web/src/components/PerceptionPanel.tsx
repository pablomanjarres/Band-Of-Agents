import { useEffect, useRef, useState } from 'react';
import type { PerceivingLane } from '../boardState';
import type { Material } from '../types';

interface PerceptionPanelProps {
  // The materials whose perception pre-pass is live right now (concurrent).
  lanes: PerceivingLane[];
}

const STAGE_LABEL: Record<PerceivingLane['perceiving']['stage'], string> = {
  vision: 'Watching keyframes',
  stt: 'Transcribing audio',
  done: 'Perception complete',
};

const STAGE_TONE: Record<PerceivingLane['perceiving']['stage'], string> = {
  vision: 'bg-violet-500',
  stt: 'bg-sky-500',
  done: 'bg-emerald-500',
};

/**
 * The live "Analyzing" side panel (Rung C). It appears ONLY while a material is
 * being perceived and renders beside the matrix, so the campaign matrix and the
 * materials tree stay visible the whole time. One card per concurrently-perceived
 * material: a cycling keyframe thumbnail (it visibly changes as 'perceiving' ticks
 * arrive), a progress bar, the transcript typing in, and a per-region "watching"
 * badge. When no lane is perceiving (perception off), the parent renders nothing.
 */
export function PerceptionPanel({ lanes }: PerceptionPanelProps) {
  if (lanes.length === 0) return null;
  return (
    <aside className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-violet-500" />
        </span>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Analyzing {lanes.length === 1 ? 'material' : `${lanes.length} materials`}
        </h2>
      </div>
      <div className="space-y-4">
        {lanes.map((lane) => (
          <PerceptionCard key={lane.materialId} lane={lane} />
        ))}
      </div>
    </aside>
  );
}

function PerceptionCard({ lane }: { lane: PerceivingLane }) {
  const { perceiving, material } = lane;
  const stage = perceiving.stage;
  const total = Math.max(perceiving.total, 1);
  // index is 0-based and advances per frame; clamp the displayed count to total.
  const shown = Math.min(perceiving.index + 1, total);
  const pct = stage === 'done' ? 100 : Math.round((shown / total) * 100);
  const transcript = useTranscriptReveal(lane);

  return (
    <div className="overflow-hidden rounded-xl border border-violet-200 bg-gradient-to-b from-violet-50/80 to-white shadow-sm">
      {/* The cycling keyframe: a new frameUrl every tick is the model literally
          reading that frame. The key swaps the node so the fade re-triggers. */}
      <div className="relative aspect-video w-full bg-slate-900">
        {perceiving.frameUrl ? (
          <img
            key={perceiving.frameUrl}
            src={perceiving.frameUrl}
            alt={`Keyframe ${shown} of ${total}`}
            className="h-full w-full animate-frame-in object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
            {stage === 'stt' ? 'Listening to audio.' : 'Sampling frames.'}
          </div>
        )}
        <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
          <span className={`h-1.5 w-1.5 rounded-full ${STAGE_TONE[stage]} ${stage === 'done' ? '' : 'animate-pulse-soft'}`} />
          {STAGE_LABEL[stage]}
        </div>
        {stage !== 'done' ? (
          <div className="absolute bottom-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
            frame {shown}/{total}
          </div>
        ) : null}
      </div>

      <div className="space-y-3 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-semibold text-slate-800">
            {material.name ?? material.id}
          </p>
          <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
            {material.kind}
          </span>
        </div>

        {/* Progress bar (index/total). Smooth width transition as ticks arrive. */}
        <div className="space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out ${STAGE_TONE[stage]}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-[10px] uppercase tracking-wide text-slate-400">
            {stage === 'done' ? 'Cascading to reviewers.' : `${pct}% analyzed`}
          </p>
        </div>

        {/* Per-region "watching" badges: every region that will review this
            material is shown actively watching during the pre-pass. */}
        <WatchingBadges material={material} settled={stage === 'done'} />

        {/* Transcript typing in. Sourced from the material's perception (the stream
            carries frame ticks, not transcript text); revealed progressively. */}
        {transcript !== undefined ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
            <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              <span className={`h-1.5 w-1.5 rounded-full ${stage === 'stt' ? 'animate-pulse-soft bg-sky-500' : 'bg-slate-400'}`} />
              Transcript
            </p>
            <p className="text-xs leading-relaxed text-slate-600">
              {transcript.text}
              {!transcript.complete ? (
                <span className="ml-0.5 inline-block h-3 w-1 animate-pulse-soft bg-slate-400 align-middle" />
              ) : null}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const REGIONS = ['US', 'EU', 'LATAM', 'BRAND'] as const;

// BRAND always reviews; the regional reviewers that watch a material are derived
// from its markets (a material may narrow the campaign markets).
function regionsFor(material: Material): string[] {
  const fromMarkets = REGIONS.filter(
    (region) => region === 'BRAND' || material.markets.includes(region),
  );
  return fromMarkets.length > 0 ? fromMarkets : [...REGIONS];
}

function WatchingBadges({ material, settled }: { material: Material; settled: boolean }) {
  const regions = regionsFor(material);
  return (
    <div className="flex flex-wrap gap-1.5">
      {regions.map((region) => (
        <span
          key={region}
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 shadow-sm"
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${settled ? 'bg-emerald-500' : 'animate-pulse-soft bg-amber-400'}`}
          />
          {region} {settled ? 'ready' : 'watching'}
        </span>
      ))}
    </div>
  );
}

interface RevealState {
  text: string;
  complete: boolean;
}

/**
 * Type the material transcript in for the demo. The perception stream sends frame
 * ticks (not transcript deltas), so we animate the known transcript ourselves: it
 * starts revealing once audio analysis begins (stage stt/done) and types to the
 * end. Returns undefined when there is no transcript to show.
 */
function useTranscriptReveal(lane: PerceivingLane): RevealState | undefined {
  const full = lane.transcript;
  const stage = lane.perceiving.stage;
  const [count, setCount] = useState(0);
  // Reset the reveal when the material or its transcript changes.
  const keyRef = useRef<string>('');
  const key = `${lane.materialId}:${full ?? ''}`;
  if (keyRef.current !== key) {
    keyRef.current = key;
    if (count !== 0) setCount(0);
  }

  // Reveal only after the vision phase (transcript belongs to the audio stage).
  const revealing = stage === 'stt' || stage === 'done';

  useEffect(() => {
    if (!full || !revealing) return;
    if (count >= full.length) return;
    // On 'done' show the whole thing promptly; while transcribing, type smoothly.
    if (stage === 'done') {
      const id = window.setTimeout(() => setCount(full.length), 120);
      return () => window.clearTimeout(id);
    }
    const step = Math.max(1, Math.ceil(full.length / 60));
    const id = window.setTimeout(() => setCount((c) => Math.min(full.length, c + step)), 40);
    return () => window.clearTimeout(id);
  }, [full, revealing, stage, count]);

  if (full === undefined) return undefined;
  if (!revealing) {
    // Before audio analysis, hint that the transcript is pending.
    return { text: '', complete: false };
  }
  return { text: full.slice(0, count), complete: count >= full.length };
}
