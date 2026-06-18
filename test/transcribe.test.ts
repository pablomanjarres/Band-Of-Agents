// Upload-time transcription (src/perception/transcribe.ts).
//
// transcribeVideoMaterial is what POST /api/videos calls right after hosting an
// uploaded video: it resolves the local file, ffmpeg-extracts the audio, runs the
// STT client, and returns the perception to persist on the material. These tests
// pin:
//   1. with a STUB SttClient and a REAL local video (that HAS an audio track), the
//      returned perception carries the transcript (and sampled keyframes).
//   2. graceful degradation: no STT client, no local file, and no audio track each
//      return an empty transcript WITHOUT throwing.
//   3. prior perception (a pasted transcript / a visual description) is preserved
//      when a step cannot improve on it (the merge is never destructive).
//
// Real ffmpeg is used (the synthesized clips are tiny). The tests self-skip the
// ffmpeg-dependent assertions if ffmpeg is not on PATH, so the suite still passes
// on a box without it (the graceful paths are still exercised).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transcribeVideoMaterial } from '../src/perception/transcribe';
import { StubSttClient } from '../src/models/client';
import { Material } from '../src/domain/types';

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

let workdir: string;
let toneMp4: string | undefined; // a clip WITH an audio track
let silentMp4: string | undefined; // a clip with NO audio track

/** Synthesize a tiny mp4 via ffmpeg; returns the path or undefined on failure. */
function synth(args: string[], out: string): string | undefined {
  const r = spawnSync('ffmpeg', ['-y', ...args, out], { stdio: 'ignore' });
  return r.status === 0 && existsSync(out) ? out : undefined;
}

beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), 'transcribe-test-'));
  if (!hasFfmpeg) return;
  toneMp4 = synth(
    ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=1', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'],
    join(workdir, 'tone.mp4'),
  );
  silentMp4 = synth(
    ['-f', 'lavfi', '-i', 'color=c=red:s=160x120:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p'],
    join(workdir, 'silent.mp4'),
  );
});

afterAll(() => {
  try {
    rmSync(workdir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

function videoMaterial(extra: Partial<Material> = {}): Material {
  return Material.parse({
    id: 'upload-vid',
    kind: 'video',
    channel: 'instagram',
    markets: ['US'],
    copy: 'x',
    claim: 'x',
    videoUrl: '/api/videos/upload-vid.mp4',
    ...extra,
  });
}

describe('transcribeVideoMaterial: stub STT over a real local video', () => {
  it('sets the transcript from the STT client (and samples keyframes)', async () => {
    if (!hasFfmpeg || !toneMp4) {
      // No ffmpeg/clip: nothing to extract; the STT text must not leak (no local
      // file), and the text-on-screen fallback synthesizes a perception instead.
      const p = await transcribeVideoMaterial(videoMaterial(), {
        sttModel: new StubSttClient(() => ({ text: 'should not appear without a local file' })),
        resolveVideoPath: () => undefined,
      });
      expect(p.transcript).not.toContain('should not appear');
      expect(p.transcript && p.transcript.length).toBeTruthy();
      return;
    }
    const stt = new StubSttClient(() => ({ text: 'Northwind Immune plus helps maintain your immune response.' }));
    const perception = await transcribeVideoMaterial(videoMaterial(), {
      sttModel: stt,
      resolveVideoPath: () => toneMp4,
      maxFrames: 2,
    });
    expect(perception.transcript).toBe('Northwind Immune plus helps maintain your immune response.');
    // Keyframes were sampled too (priority is the transcript, but frames help the UI).
    expect(perception.frames.length).toBeGreaterThan(0);
    expect(perception.frames.every((f) => typeof f === 'string')).toBe(true);
  });

  it('passes the extracted AUDIO bytes (not zero bytes) to the STT client', async () => {
    if (!hasFfmpeg || !toneMp4) return;
    let sawBytes = 0;
    const stt = new StubSttClient((req) => {
      sawBytes = req.audio.byteLength;
      return { text: 'ok' };
    });
    await transcribeVideoMaterial(videoMaterial(), { sttModel: stt, resolveVideoPath: () => toneMp4, maxFrames: 0 });
    expect(sawBytes).toBeGreaterThan(0);
  });
});

describe('transcribeVideoMaterial: graceful degradation (no throw, synthesized text-on-screen perception)', () => {
  // A video with no SPOKEN transcript carries its message as on-screen text, so the
  // fallback synthesizes a coherent perception (never throws, never leaks STT text).
  it('no STT client => synthesized perception, no throw', async () => {
    if (!hasFfmpeg || !toneMp4) return;
    const perception = await transcribeVideoMaterial(videoMaterial(), {
      resolveVideoPath: () => toneMp4,
      maxFrames: 0,
    });
    expect(perception.transcript && perception.transcript.length).toBeTruthy();
    expect(perception.onScreenText && perception.onScreenText.length).toBeTruthy();
    expect(perception.detectedClaims && perception.detectedClaims.length).toBeGreaterThan(0);
  });

  it('no local file (unresolvable videoUrl) => synthesized perception, no throw, no frames', async () => {
    const perception = await transcribeVideoMaterial(videoMaterial(), {
      sttModel: new StubSttClient(() => ({ text: 'canned' })),
      resolveVideoPath: () => undefined,
    });
    // No real audio was read, so the STT canned text must not leak; a synthesized
    // transcript stands in instead, and there are still no frames.
    expect(perception.transcript).not.toBe('canned');
    expect(perception.transcript && perception.transcript.length).toBeTruthy();
    expect(perception.frames).toEqual([]);
  });

  it('a video with NO audio track => synthesized perception, no throw (STT text never leaks)', async () => {
    if (!hasFfmpeg || !silentMp4) return;
    const perception = await transcribeVideoMaterial(videoMaterial(), {
      // The stub WOULD return canned text, but no audio is extracted so STT is
      // never reached: the synthesized text-on-screen perception stands in.
      sttModel: new StubSttClient(() => ({ text: 'canned should not appear' })),
      resolveVideoPath: () => silentMp4,
      maxFrames: 0,
    });
    expect(perception.transcript).not.toContain('canned should not appear');
    expect(perception.transcript && perception.transcript.length).toBeTruthy();
  });

  it('a non-video material is left untouched', async () => {
    const post = Material.parse({ id: 'p1', kind: 'post', channel: 'x', markets: ['US'], copy: 'x', claim: 'x' });
    const perception = await transcribeVideoMaterial(post, {
      sttModel: new StubSttClient(() => ({ text: 'canned' })),
      resolveVideoPath: () => toneMp4 ?? '/nope',
    });
    expect(perception.transcript).toBeUndefined();
    expect(perception.frames).toEqual([]);
  });
});

describe('transcribeVideoMaterial: prior perception is preserved (non-destructive merge)', () => {
  it('keeps a pasted transcript when no new transcript is produced', async () => {
    const pasted = 'Pasted transcript: helps maintain your immune response.';
    const perception = await transcribeVideoMaterial(
      videoMaterial({ perception: { frames: ['/api/images/seed.png'], transcript: pasted, visualDescription: 'a flat-lay' } }),
      { resolveVideoPath: () => undefined }, // no local file: nothing new
    );
    expect(perception.transcript).toBe(pasted);
    expect(perception.frames).toEqual(['/api/images/seed.png']);
    expect(perception.visualDescription).toBe('a flat-lay');
  });

  it('a NEW transcript overrides the pasted one when STT succeeds', async () => {
    if (!hasFfmpeg || !toneMp4) return;
    const perception = await transcribeVideoMaterial(
      videoMaterial({ perception: { frames: [], transcript: 'old pasted' } }),
      {
        sttModel: new StubSttClient(() => ({ text: 'fresh transcription' })),
        resolveVideoPath: () => toneMp4,
        maxFrames: 0,
      },
    );
    expect(perception.transcript).toBe('fresh transcription');
  });
});
