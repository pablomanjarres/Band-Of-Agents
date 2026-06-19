// Veo smoke test (Vertex): confirm text-to-video works on this GCP project and
// learn the return shape (inline videoBytes vs gs:// uri) before mass generation.
// Also re-confirms the Vertex image path. Writes any inline bytes to /tmp so we
// can eyeball a real mp4. Tiny prompt, one short clip.
//
//   GOOGLE_CLOUD_PROJECT=$(gcloud config get-value project) pnpm exec tsx src/run/veo-smoke.ts

import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { GeminiModelClient } from '../models/gemini';

async function main(): Promise<void> {
  console.log(`project=${process.env.GOOGLE_CLOUD_PROJECT ?? '(unset)'} location=${process.env.GOOGLE_CLOUD_LOCATION ?? '(unset)'} veo=${process.env.VEO_MODEL ?? 'veo-3.0-fast-generate-001'}`);
  const m = new GeminiModelClient({ model: 'gemini-2.5-flash' });

  // 1) Vertex image (quick sanity that the Vertex auth/path is good).
  try {
    const img = await m.generateImage({ prompt: 'A simple flat-vector lemon on a white background.' });
    console.log(`[ok] vertex image: ${img.url ? `url:${img.url}` : img.b64 ? `b64 ${img.b64.length} chars` : 'nothing'}`);
  } catch (e) {
    console.error(`[FAIL] vertex image: ${(e as Error)?.message ?? e}`);
  }

  // 2) Veo video.
  const t0 = Date.now();
  try {
    // veo-3-fast wants its own defaults: do NOT pass durationSeconds/generateAudio
    // (either yields an empty result). Prompt + aspectRatio only.
    const vid = await m.generateVideo({
      prompt: 'A bright product hero shot: a single sleek bottle on a clean studio table, slow push-in, soft morning light.',
      aspectRatio: '16:9',
    });
    const secs = Math.round((Date.now() - t0) / 1000);
    console.log(`[ok] veo (${secs}s): url=${vid.url ?? '(none)'} mime=${vid.mimeType ?? '(none)'} bytes=${vid.b64 ? `${vid.b64.length} b64 chars` : '(none)'}`);
    if (vid.b64) {
      const buf = Buffer.from(vid.b64, 'base64');
      const path = '/tmp/veo-smoke.mp4';
      writeFileSync(path, buf);
      console.log(`     wrote ${buf.byteLength} bytes -> ${path}`);
    }
  } catch (e) {
    const secs = Math.round((Date.now() - t0) / 1000);
    console.error(`[FAIL] veo (${secs}s): ${(e as Error)?.message ?? e}`);
  }

  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
