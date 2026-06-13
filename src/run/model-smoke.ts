// Live model smoke test (dev mode): confirm Bedrock-Claude, Vertex-Gemini, and
// Nano Banana (Vertex gemini-2.5-flash-image) work with the local AWS/GCP creds.
// Tiny prompts. Each call is isolated so one failure does not block the others.
//
//   GOOGLE_CLOUD_PROJECT=$(gcloud config get-value project) pnpm exec tsx src/run/model-smoke.ts

import 'dotenv/config';
import { activeMode, imageClientFor, modelFor } from '../models/route';

async function probe(label: string, fn: () => Promise<string>): Promise<void> {
  try {
    const out = await fn();
    console.log(`[ok] ${label}: ${out.slice(0, 140)}`);
  } catch (e) {
    console.error(`[FAIL] ${label}: ${(e as Error)?.message ?? String(e)}`);
  }
}

async function main(): Promise<void> {
  console.log(`mode=${activeMode()} project=${process.env.GOOGLE_CLOUD_PROJECT ?? '(unset)'} region=${process.env.AWS_REGION ?? '(unset)'}`);

  await probe('bedrock-claude (US)', async () => {
    const m = modelFor('us', 'dev');
    const r = await m.complete({ system: 'Reply with exactly one word.', messages: [{ role: 'user', content: 'Say OK.' }], maxTokens: 16 });
    return `[${m.model}] ${r.text}`;
  });

  await probe('vertex-gemini (EU)', async () => {
    const m = modelFor('eu', 'dev');
    const r = await m.complete({ messages: [{ role: 'user', content: 'Say OK in one word.' }], maxTokens: 16 });
    return `[${m.model}] ${r.text}`;
  });

  await probe('nano-banana image (Vertex)', async () => {
    const m = imageClientFor('dev');
    if (!m.generateImage) return 'no generateImage on client';
    const img = await m.generateImage({ prompt: 'A simple flat-vector lemon on a white background.' });
    return img.url ? `url:${img.url}` : img.b64 ? `b64 image, ${img.b64.length} chars` : 'no image returned';
  });

  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
