// Rung C: the multimodal perception pre-pass.
//
// Perception is a PRE-PASS, not per-region vision: one vision model "sees" each
// material once and one Whisper-class model "hears" it, producing TEXT artifacts
// that cascade to EVERY reviewer (even the text-only one). These tests pin:
//   1. perceiveMaterial with a STUBBED vision + STT model emits a 'perceiving'
//      tick per frame and returns a MaterialPerception (transcript + visual
//      description + detected claims) built from the seeded frames (no ffmpeg).
//   2. those artifacts cascade into the region-reviewer prompt through a real
//      BoardSession run (the Rung A cascade carries the perception text).
//   3. graceful degradation: with NO ffmpeg and NO models the pass still returns a
//      usable result (the pasted transcript / seeded frames survive) and the
//      material still reviews text-only.
//
// No real network and no ffmpeg are used: the video materials carry seeded frames
// so the ffmpeg branch is never taken, and the models are stubs.

import { describe, expect, it } from 'vitest';
import { perceiveMaterial, type PerceiveStage } from '../src/perception/perceive';
import { BoardSession } from '../src/board/session';
import {
  StubModelClient,
  StubSttClient,
  type CompleteRequest,
  type ModelClient,
  type SttClient,
} from '../src/models/client';
import { loadBrandDna, loadRulebook } from '../src/domain/load';
import { Material } from '../src/domain/types';
import type { BoardEvent } from '../src/board/events';

const ASSETS = new URL('../assets/', import.meta.url).pathname;

const FRAMES = [
  '/api/images/immune-plus-frame-01.png',
  '/api/images/immune-plus-frame-02.png',
  '/api/images/immune-plus-frame-03.png',
];

/** A video material carrying seeded frames (so the ffmpeg path is skipped). */
function heroVideo(extra: Partial<Material> = {}): Material {
  return Material.parse({
    id: 'hero-video',
    name: 'Hero Video',
    kind: 'video',
    channel: 'instagram',
    markets: ['US', 'EU', 'LATAM'],
    copy: 'Feel your best. Northwind Immune+ helps maintain your immune response.',
    claim: 'helps maintain immune response',
    videoUrl: 'https://cdn.example.com/hero.mp4',
    perception: { frames: FRAMES },
    ...extra,
  });
}

/** A vision stub that returns canned artifacts and records the content it saw. */
function visionStub(seen: { content?: unknown }): ModelClient {
  return new StubModelClient((req: CompleteRequest) => {
    seen.content = req.messages[0]?.content;
    return {
      text: '',
      json: {
        visualDescription: 'Warm flat-lay of Immune+ bottles with citrus, then a close-up.',
        onScreenText: 'Northwind Immune+ | 9 out of 10 felt the difference',
        detectedClaims: ['Helps maintain your immune response', '9 out of 10 felt the difference'],
      },
    };
  });
}

const CANNED_TRANSCRIPT =
  'Feeling run down? Northwind Immune plus helps maintain your immune response so you can feel your best.';

function sttStub(): SttClient {
  return new StubSttClient(() => ({ text: CANNED_TRANSCRIPT }));
}

describe('perceiveMaterial: vision + STT pre-pass over seeded frames', () => {
  it('emits a perceiving tick per frame and returns the full MaterialPerception', async () => {
    const seen: { content?: unknown } = {};
    const ticks: Array<{ index: number; total: number; stage: PerceiveStage; frameUrl?: string }> = [];

    const perception = await perceiveMaterial(heroVideo(), {
      visionModel: visionStub(seen),
      sttModel: sttStub(),
      onFrame: (frameUrl, index, total, stage) =>
        ticks.push({ index, total, stage, ...(frameUrl !== undefined ? { frameUrl } : {}) }),
    });

    // One vision tick per seeded frame, each pointing at that frame.
    const visionTicks = ticks.filter((t) => t.stage === 'vision');
    expect(visionTicks).toHaveLength(FRAMES.length);
    expect(visionTicks.map((t) => t.frameUrl)).toEqual(FRAMES);
    expect(visionTicks.every((t) => t.total === FRAMES.length)).toBe(true);
    // The pass also ticks the stt stage and a final done stage.
    expect(ticks.some((t) => t.stage === 'stt')).toBe(true);
    expect(ticks.some((t) => t.stage === 'done')).toBe(true);

    // The returned artifacts (all three modalities) are populated.
    expect(perception.frames).toEqual(FRAMES);
    expect(perception.transcript).toBe(CANNED_TRANSCRIPT);
    expect(perception.visualDescription).toContain('flat-lay');
    expect(perception.onScreenText).toContain('Northwind');
    expect(perception.detectedClaims).toContain('Helps maintain your immune response');

    // The vision call actually received image content blocks (the only place the
    // multimodal seam is exercised): one text block + one image block per frame.
    const content = seen.content as Array<{ type: string; url?: string }>;
    expect(Array.isArray(content)).toBe(true);
    const imageBlocks = content.filter((b) => b.type === 'image');
    expect(imageBlocks.map((b) => b.url)).toEqual(FRAMES);
    expect(content.some((b) => b.type === 'text')).toBe(true);
  });

  it('a single image material uses its image as the only frame', async () => {
    const image = Material.parse({
      id: 'hero-thumb',
      kind: 'image',
      channel: 'instagram',
      markets: ['US'],
      copy: 'Daily immune support.',
      claim: 'daily immune support',
      imageUrl: '/api/images/immune-plus-frame-04.png',
    });
    const ticks: number[] = [];
    const perception = await perceiveMaterial(image, {
      visionModel: visionStub({}),
      onFrame: (_url, _i, total) => ticks.push(total),
    });
    expect(perception.frames).toEqual(['/api/images/immune-plus-frame-04.png']);
    expect(perception.visualDescription).toBeTruthy();
  });
});

describe('perception graceful degradation (no ffmpeg, no models)', () => {
  it('keeps the pasted transcript and seeded frames, and never throws', async () => {
    // No vision model, no STT model: the only inputs are the seeded frames and a
    // pasted transcript. The pass must return them intact (a usable result).
    const pasted = 'Pasted transcript: helps maintain your immune response.';
    const perception = await perceiveMaterial(
      heroVideo({ perception: { frames: FRAMES, transcript: pasted } }),
      {},
    );
    expect(perception.frames).toEqual(FRAMES);
    expect(perception.transcript).toBe(pasted);
    // No vision model => no visual description was synthesized.
    expect(perception.visualDescription).toBeUndefined();
  });

  it('a video with a remote url and NO seeded frames returns an empty-but-usable result', async () => {
    // videoUrl is http(s) (not a local file) and there are no seeded frames, so
    // with no ffmpeg/model there is simply nothing to see: frames [] and no throw.
    const perception = await perceiveMaterial(
      Material.parse({
        id: 'no-frames',
        kind: 'video',
        channel: 'x',
        markets: ['US'],
        copy: 'x',
        claim: 'x',
        videoUrl: 'https://cdn.example.com/none.mp4',
      }),
      {},
    );
    expect(perception.frames).toEqual([]);
    expect(perception.transcript).toBeUndefined();
  });

  it('a vision-model error degrades to text-only (no throw, no artifacts)', async () => {
    const throwingVision: ModelClient = new StubModelClient(() => {
      throw new Error('vision provider down');
    });
    const perception = await perceiveMaterial(heroVideo(), { visionModel: throwingVision });
    expect(perception.frames).toEqual(FRAMES); // frames still collected
    expect(perception.visualDescription).toBeUndefined(); // vision failed, skipped
  });
});

describe('perception artifacts cascade into the region-reviewer prompt', () => {
  it('a reviewer sees the transcript, visual description, and detected claims', async () => {
    const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
    const rulebooks = {
      us: loadRulebook(`${ASSETS}rulebook.us.json`),
      eu: loadRulebook(`${ASSETS}rulebook.eu.json`),
      latam: loadRulebook(`${ASSETS}rulebook.latam.json`),
    };

    // Capture every reviewer user-prompt; reviewers return no findings.
    const seenUserPrompts: string[] = [];
    const capture = new StubModelClient((req: CompleteRequest) => {
      const u = req.messages[req.messages.length - 1]?.content;
      seenUserPrompts.push(typeof u === 'string' ? u : JSON.stringify(u));
      return { text: '', json: { findings: [] } };
    });

    const events: BoardEvent[] = [];
    const session = new BoardSession({
      roomId: 'perception-cascade',
      asset: heroVideo(),
      brand,
      rulebooks,
      models: {
        us: capture,
        eu: capture,
        latam: capture,
        brand: capture,
        remediationCopy: new StubModelClient(() => ({ text: '' })),
        image: { model: 'stub', complete: async () => ({ text: '' }), generateImage: async () => ({}) },
      },
      // Stub perception so a transcript + description are synthesized for the cascade.
      perception: { vision: visionStub({}), stt: sttStub() },
      // Campaign context so the perceiving events are tagged (and the dossier path
      // is the one used by a campaign material).
      campaign: {
        campaignId: 'immune-plus-q3',
        materialId: 'hero-video',
        dossier: { approvedClaims: [], substantiation: '', approvedInfo: '', sources: [] },
      },
      onEvent: (e) => events.push(e),
    });

    await session.run();

    // The perceiving events streamed (tagged with the campaign + material ids).
    const perceiving = events.filter((e): e is Extract<BoardEvent, { type: 'perceiving' }> => e.type === 'perceiving');
    expect(perceiving.length).toBeGreaterThan(0);
    expect(perceiving.every((e) => e.materialId === 'hero-video' && e.campaignId === 'immune-plus-q3')).toBe(true);

    // Every reviewer's prompt carried the perception artifacts (the cascade).
    expect(seenUserPrompts.length).toBeGreaterThan(0);
    const withTranscript = seenUserPrompts.filter((p) => p.includes(CANNED_TRANSCRIPT));
    expect(withTranscript.length).toBe(seenUserPrompts.length);
    expect(seenUserPrompts.every((p) => p.includes('flat-lay'))).toBe(true);
    expect(seenUserPrompts.every((p) => p.includes('Helps maintain your immune response'))).toBe(true);

    // And the material still reviewed (it reached a terminal status).
    expect(events.some((e) => e.type === 'status' && (e.status === 'complete' || e.status === 'awaiting-decision'))).toBe(true);
  });
});
