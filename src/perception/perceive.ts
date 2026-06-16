// Multimodal perception pre-pass. ONE vision-capable model "sees" each video or
// image material once and ONE Whisper-class model "hears" the audio, producing
// TEXT artifacts (visual description, on-screen text, detected claims, transcript)
// that cascade to EVERY reviewer (even a text-only region model). Only this
// pre-pass sends image content blocks; the reviewer roles stay text-only.
//
// Graceful degradation is mandatory at EVERY step, so a material ALWAYS still
// reviews and the text demo never breaks:
//   - frames: a local video + ffmpeg => sampled keyframes (hosted); else the
//     material's seeded frames / imageUrl; else [].
//   - vision: frames + a vision model => one call; else skip (text-only).
//   - stt: a local video + an stt model => transcript; else the pasted transcript
//     (material.perception.transcript); else none.
// Nothing here throws on a missing tool, a missing key, or a model error.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelClient, SttClient } from '../models/client';
import type { Material, MaterialPerception } from '../domain/types';

/** Which perception stage a frame tick belongs to (mirrors the BoardEvent stage). */
export type PerceiveStage = 'vision' | 'stt' | 'done';

export interface PerceiveOptions {
  /** Vision-capable model; when absent, the vision step is skipped (text-only). */
  visionModel?: ModelClient;
  /** Whisper-class STT client; when absent, a pasted transcript is kept instead. */
  sttModel?: SttClient;
  /** Decode a base64/data-URL frame to a hosted URL; pass-through for hosted URLs. */
  hostImage?: (url: string) => string;
  /** Per-frame progress hook so the UI can animate (frameUrl, index, total, stage). */
  onFrame?: (frameUrl: string | undefined, index: number, total: number, stage: PerceiveStage) => void;
  /** Max keyframes to sample from a video (ffmpeg path). Default 6. */
  maxFrames?: number;
  /** Resolve a material.videoUrl to a local file path for ffmpeg/STT (e.g. data/videos/<id>.mp4). */
  resolveVideoPath?: (videoUrl: string) => string | undefined;
}

// JSON Schema for the single vision call. Mirrors the perception artifact text
// fields; frames are added by us, not the model.
const VISION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['visualDescription'],
  properties: {
    visualDescription: { type: 'string' },
    onScreenText: { type: 'string' },
    detectedClaims: { type: 'array', items: { type: 'string' } },
  },
} as const;

/**
 * Perceive one material into a MaterialPerception. Safe to call on any material:
 * a non-visual material with no seeded frames returns an (almost) empty result.
 * Existing perception on the material (e.g. a pasted transcript) is the floor and
 * is preserved when a step cannot improve on it.
 */
export async function perceiveMaterial(
  material: Material,
  opts: PerceiveOptions = {},
): Promise<MaterialPerception> {
  const prior = material.perception;
  // 1) Frames: ffmpeg keyframes (best) -> seeded frames -> single image -> [].
  const frames = await collectFrames(material, opts);

  // Emit a frame tick per frame so the UI cycles the keyframe being read. When a
  // vision model is present the stage is 'vision'; otherwise these are still shown
  // (the frames exist) but no model call follows.
  const total = frames.length;
  frames.forEach((frameUrl, i) => opts.onFrame?.(frameUrl, i, total, 'vision'));

  // 2) Vision: ONE call over text + image blocks, if we have both frames and a model.
  const vision = frames.length > 0 && opts.visionModel ? await runVision(opts.visionModel, frames) : undefined;

  // 3) STT: transcribe a local video if we have an stt model; else keep the
  // pasted transcript. Emit one stt tick so the UI can switch the panel to audio.
  opts.onFrame?.(undefined, total, total, 'stt');
  const transcript = await runStt(material, opts, prior?.transcript);

  // Signal completion (the panel can settle on the last frame / final transcript).
  opts.onFrame?.(frames[frames.length - 1], total, total, 'done');

  // Merge: a step that produced nothing leaves the prior value intact.
  const out: MaterialPerception = { frames };
  const visualDescription = vision?.visualDescription ?? prior?.visualDescription;
  const onScreenText = vision?.onScreenText ?? prior?.onScreenText;
  const detectedClaims = vision?.detectedClaims ?? prior?.detectedClaims;
  if (transcript) out.transcript = transcript;
  if (visualDescription) out.visualDescription = visualDescription;
  if (onScreenText) out.onScreenText = onScreenText;
  if (detectedClaims && detectedClaims.length > 0) out.detectedClaims = detectedClaims;
  return out;
}

/** Frames, in priority order, with graceful fallback. Never throws. */
async function collectFrames(material: Material, opts: PerceiveOptions): Promise<string[]> {
  // (a) Real keyframes from a local video file via ffmpeg (when present).
  const localPath =
    material.kind === 'video' && material.videoUrl
      ? opts.resolveVideoPath?.(material.videoUrl) ?? localFile(material.videoUrl)
      : undefined;
  if (localPath && existsSync(localPath)) {
    const extracted = await extractKeyframes(localPath, opts);
    if (extracted.length > 0) return extracted;
  }
  // (b) Seeded frames already on the material's perception (demo-deterministic).
  if (material.perception?.frames && material.perception.frames.length > 0) {
    return material.perception.frames;
  }
  // (c) A single image material: its image is the only "frame".
  if (material.imageUrl) return [material.imageUrl];
  // (d) Nothing visual to look at.
  return [];
}

/** Treat a file:// or bare path videoUrl as a local file; http(s) is not local. */
function localFile(videoUrl: string): string | undefined {
  if (videoUrl.startsWith('file://')) return videoUrl.slice('file://'.length);
  if (/^https?:\/\//i.test(videoUrl)) return undefined;
  return videoUrl;
}

/**
 * Extract up to maxFrames evenly-spaced keyframes with ffmpeg, host each, and
 * return the hosted URLs. Any failure (no ffmpeg, bad file) resolves to [] so the
 * caller falls back. ffmpeg is spawned, never shelled, and is fully isolated.
 */
async function extractKeyframes(videoPath: string, opts: PerceiveOptions): Promise<string[]> {
  const n = Math.max(1, opts.maxFrames ?? 6);
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), 'perceive-'));
    const pattern = join(dir, 'frame-%03d.jpg');
    // fps filter sampling a handful of frames across the clip; scale keeps them small.
    const args = ['-y', '-i', videoPath, '-vf', `fps=1,scale=512:-1`, '-frames:v', String(n), pattern];
    const ok = await runFfmpeg(args);
    if (!ok) return [];
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.jpg'))
      .sort()
      .slice(0, n);
    const out: string[] = [];
    for (const f of files) {
      const bytes = readFileSync(join(dir, f));
      const dataUrl = `data:image/jpeg;base64,${bytes.toString('base64')}`;
      out.push(opts.hostImage ? opts.hostImage(dataUrl) : dataUrl);
    }
    return out;
  } catch {
    return [];
  } finally {
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}

/** Spawn ffmpeg; resolve true on exit 0, false on any error/non-zero. Never throws. */
function runFfmpeg(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };
    try {
      const proc = spawn('ffmpeg', args, { stdio: 'ignore' });
      proc.on('error', () => done(false)); // ffmpeg not installed
      proc.on('close', (code) => done(code === 0));
    } catch {
      done(false);
    }
  });
}

/** One vision call over text + image blocks; returns undefined on any failure. */
async function runVision(
  model: ModelClient,
  frames: string[],
): Promise<{ visualDescription?: string; onScreenText?: string; detectedClaims?: string[] } | undefined> {
  try {
    const content = [
      {
        type: 'text' as const,
        text:
          'You are a perception model for a marketing-compliance review. Look at these sampled keyframes from one marketing material and report what they show. Return JSON {"visualDescription","onScreenText","detectedClaims":[]}: a concise visual description, any on-screen text you can read (OCR), and every marketing/health claim a viewer would take away.',
      },
      ...frames.map((url) => ({ type: 'image' as const, url })),
    ];
    const res = await model.complete({
      messages: [{ role: 'user', content }],
      jsonSchema: VISION_JSON_SCHEMA,
    });
    const raw = (res.json ?? safeParse(res.text)) as
      | { visualDescription?: unknown; onScreenText?: unknown; detectedClaims?: unknown }
      | undefined;
    if (!raw || typeof raw !== 'object') return undefined;
    const out: { visualDescription?: string; onScreenText?: string; detectedClaims?: string[] } = {};
    if (typeof raw.visualDescription === 'string') out.visualDescription = raw.visualDescription;
    if (typeof raw.onScreenText === 'string') out.onScreenText = raw.onScreenText;
    if (Array.isArray(raw.detectedClaims)) out.detectedClaims = raw.detectedClaims.filter((c): c is string => typeof c === 'string');
    return out;
  } catch {
    return undefined; // vision unavailable: degrade to text-only
  }
}

/**
 * Transcribe a local video's audio if both a local file and an stt model exist;
 * otherwise keep the pasted transcript. Never throws (degrades to the fallback).
 */
async function runStt(
  material: Material,
  opts: PerceiveOptions,
  pasted: string | undefined,
): Promise<string | undefined> {
  if (!opts.sttModel || material.kind !== 'video' || !material.videoUrl) return pasted;
  // Read the audio bytes when the video resolves to a local file; otherwise pass
  // empty bytes so the call still happens (a stub returns its canned transcript;
  // a real client throws on empty audio and is caught -> the pasted transcript
  // survives). Either way STT degrades gracefully and never throws.
  const path = opts.resolveVideoPath?.(material.videoUrl) ?? localFile(material.videoUrl);
  const audio = path && existsSync(path) ? new Uint8Array(readFileSync(path)) : new Uint8Array(0);
  try {
    const res = await opts.sttModel.transcribe({
      audio,
      filename: `${material.id}.mp4`,
      contentType: 'video/mp4',
    });
    return res.text && res.text.trim().length > 0 ? res.text : pasted;
  } catch {
    return pasted; // STT unavailable: keep the pasted transcript
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
