// Upload-time transcription for a video material. This runs when a video is
// UPLOADED (POST /api/videos), so the material carries a transcript before any
// review starts; the review-time perception pre-pass (perceive.ts) still runs and
// can refine it. Steps, every one graceful (never throws):
//   1. resolve the material's videoUrl to a local file (store.videoPath);
//   2. ffmpeg-extract the audio track to a temp mp3 (smaller than the container);
//   3. call the STT client on those bytes -> transcript;
//   4. optionally ffmpeg-extract a few keyframes (hosted) so the analyzing panel
//      has something to show; transcript is the priority.
// With no STT client, no ffmpeg, or no audio track the transcript is simply left
// empty (the prior perception survives) and the upload still succeeds.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SttClient } from '../models/client';
import type { Material, MaterialPerception } from '../domain/types';

export interface TranscribeOptions {
  /** Whisper-class STT client; when absent, the transcript is left empty (graceful). */
  sttModel?: SttClient;
  /** Resolve a material.videoUrl to a local file path (e.g. store.videoPath). */
  resolveVideoPath?: (videoUrl: string) => string | undefined;
  /** Decode a base64/data-URL frame to a hosted URL; pass-through for hosted URLs. */
  hostImage?: (url: string) => string;
  /** Max keyframes to sample for the analyzing panel (0 to skip frames). Default 3. */
  maxFrames?: number;
}

/**
 * Transcribe an uploaded video material and return the perception to persist on
 * it. The returned MaterialPerception MERGES onto any prior perception: a step
 * that produced nothing (no STT, no ffmpeg, no audio) leaves the prior value
 * intact, so calling this is always safe and never destructive. Never throws.
 */
export async function transcribeVideoMaterial(
  material: Material,
  opts: TranscribeOptions = {},
): Promise<MaterialPerception> {
  const prior = material.perception;
  const base: MaterialPerception = { frames: prior?.frames ?? [] };
  if (prior?.transcript) base.transcript = prior.transcript;
  if (prior?.onScreenText) base.onScreenText = prior.onScreenText;
  if (prior?.visualDescription) base.visualDescription = prior.visualDescription;
  if (prior?.detectedClaims && prior.detectedClaims.length > 0) base.detectedClaims = prior.detectedClaims;

  // Only a video with a resolvable local file can be transcribed/sampled here.
  const localPath =
    material.kind === 'video' && material.videoUrl
      ? opts.resolveVideoPath?.(material.videoUrl)
      : undefined;
  if (!localPath || !existsSync(localPath)) return base;

  // 1) Transcript (the priority). Extract audio -> bytes -> STT.
  if (opts.sttModel) {
    const transcript = await transcribeAudio(localPath, material.id, opts.sttModel);
    if (transcript) base.transcript = transcript;
  }

  // 2) Keyframes for the analyzing panel (best-effort; transcript already set).
  const maxFrames = opts.maxFrames ?? 3;
  if (maxFrames > 0) {
    const frames = await extractKeyframes(localPath, maxFrames, opts.hostImage);
    if (frames.length > 0) base.frames = frames;
  }

  return base;
}

/** Extract the audio to a temp mp3, read it, and transcribe. Empty string on any failure. */
async function transcribeAudio(videoPath: string, materialId: string, stt: SttClient): Promise<string> {
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), 'transcribe-'));
    const audioPath = join(dir, 'audio.mp3');
    // -vn drops video; libmp3lame keeps it small and widely accepted by STT models.
    const ok = await runFfmpeg(['-y', '-i', videoPath, '-vn', '-acodec', 'libmp3lame', '-q:a', '4', audioPath]);
    // No ffmpeg, or a video with NO audio track: ffmpeg yields no usable file.
    if (!ok || !existsSync(audioPath) || statSync(audioPath).size === 0) return '';
    const audio = new Uint8Array(readFileSync(audioPath));
    if (audio.byteLength === 0) return '';
    const res = await stt.transcribe({ audio, filename: `${materialId}.mp3`, contentType: 'audio/mpeg' });
    return res.text && res.text.trim().length > 0 ? res.text.trim() : '';
  } catch {
    return ''; // STT/ffmpeg unavailable: leave the transcript empty (graceful)
  } finally {
    cleanup(dir);
  }
}

/** Extract up to n evenly-spaced keyframes, host each, return hosted URLs. [] on failure. */
async function extractKeyframes(
  videoPath: string,
  n: number,
  hostImage?: (url: string) => string,
): Promise<string[]> {
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), 'transcribe-frames-'));
    const pattern = join(dir, 'frame-%03d.jpg');
    const ok = await runFfmpeg(['-y', '-i', videoPath, '-vf', 'fps=1,scale=512:-1', '-frames:v', String(n), pattern]);
    if (!ok) return [];
    const files = readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort().slice(0, n);
    const out: string[] = [];
    for (const f of files) {
      const bytes = readFileSync(join(dir, f));
      const dataUrl = `data:image/jpeg;base64,${bytes.toString('base64')}`;
      out.push(hostImage ? hostImage(dataUrl) : dataUrl);
    }
    return out;
  } catch {
    return [];
  } finally {
    cleanup(dir);
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

function cleanup(dir: string | undefined): void {
  if (!dir) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}
