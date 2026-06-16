// HTTP-level tests for the 3-tier campaign API (Rung D, server). These drive the
// real Hono app (exported from src/server/index.ts) via app.fetch, no port bound.
// The module is imported in BOARD_MODE=local with no AIML key, so reviews run on
// the deterministic key-free demo stubs (no network) and a campaign review still
// streams real per-material events and computes the observational rollup.
//
// THE ONE RULE is respected by construction: a campaign review fans out one
// concurrent BoardSession per material across every advertisement; these tests
// assert each per-material event is tagged with BOTH advertisementId and
// materialId, and that the rollup is per-advertisement + per-campaign (a read,
// never a gate).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Force the importable, side-effect-free, key-free local path BEFORE importing the
// server module (KEY_FREE_LOCAL is computed once at import time).
process.env.BOARD_MODE = 'local';
delete process.env.AIML_API_KEY;
delete process.env.MODEL_MODE;

const { app, store } = await import('../src/server/index');
import { Campaign } from '../src/domain/types';
import type { BoardEvent } from '../src/board/events';

const DATA_DIR = new URL('../data/', import.meta.url).pathname;
const CAMPAIGNS_FILE = join(DATA_DIR, 'campaigns.json');
const IMAGES_DIR = join(DATA_DIR, 'images');
const VIDEOS_DIR = join(DATA_DIR, 'videos');

// Upload-time transcription needs a real video file with an audio track to extract.
// Synthesized with ffmpeg; when ffmpeg is absent the transcription assertions
// self-skip (the upload itself must still succeed, which is asserted unconditionally).
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
let toneMp4: Uint8Array | null = null; // a clip WITH an audio track
let silentMp4: Uint8Array | null = null; // a clip with NO audio track
function synthBytes(args: string[]): Uint8Array | null {
  const out = join(DATA_DIR, `synth-${randomUUID().slice(0, 8)}.mp4`);
  const r = spawnSync('ffmpeg', ['-y', ...args, out], { stdio: 'ignore' });
  if (r.status !== 0 || !existsSync(out)) return null;
  const bytes = new Uint8Array(readFileSync(out));
  rmSync(out, { force: true });
  return bytes;
}

// Snapshot data/campaigns.json + the images dir so the suite never leaks test
// campaigns into the real seed or strays image files (both are restored after).
let snapshot: string | null = null;
let imagesBefore = new Set<string>();
let videosBefore = new Set<string>();
beforeAll(() => {
  snapshot = existsSync(CAMPAIGNS_FILE) ? readFileSync(CAMPAIGNS_FILE, 'utf8') : null;
  imagesBefore = new Set(existsSync(IMAGES_DIR) ? readdirSync(IMAGES_DIR) : []);
  videosBefore = new Set(existsSync(VIDEOS_DIR) ? readdirSync(VIDEOS_DIR) : []);
  if (hasFfmpeg) {
    toneMp4 = synthBytes(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=1', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac']);
    silentMp4 = synthBytes(['-f', 'lavfi', '-i', 'color=c=red:s=160x120:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']);
  }
});
afterAll(() => {
  if (snapshot === null) {
    if (existsSync(CAMPAIGNS_FILE)) rmSync(CAMPAIGNS_FILE);
  } else {
    writeFileSync(CAMPAIGNS_FILE, snapshot);
  }
  // Remove any image files the upload tests created (UUID-named), keep the rest.
  if (existsSync(IMAGES_DIR)) {
    for (const f of readdirSync(IMAGES_DIR)) {
      if (!imagesBefore.has(f)) rmSync(join(IMAGES_DIR, f));
    }
  }
  // Remove any video files the upload tests created, keep the rest.
  if (existsSync(VIDEOS_DIR)) {
    for (const f of readdirSync(VIDEOS_DIR)) {
      if (!videosBefore.has(f)) rmSync(join(VIDEOS_DIR, f));
    }
  }
});

const BASE = 'http://local';

function req(method: string, path: string, body?: unknown): Request {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  return new Request(`${BASE}${path}`, init);
}

/** Parse a Response body as JSON with a caller-supplied shape (res.json() is unknown under strict mode). */
async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Seed a unique three-tier campaign directly via the store, returning it. */
function seedCampaign(advertisements: Array<{ id: string; name: string; materials: Array<Record<string, unknown>> }>) {
  const id = `test-camp-${randomUUID().slice(0, 8)}`;
  const campaign = Campaign.parse({
    id,
    name: `Test ${id}`,
    markets: ['US', 'EU', 'LATAM'],
    dossier: { approvedClaims: [], substantiation: '', approvedInfo: '', sources: [] },
    advertisements,
  });
  store.saveCampaign(campaign);
  return campaign;
}

function material(id: string, kind = 'post'): Record<string, unknown> {
  return { id, kind, channel: 'x', markets: ['US', 'EU', 'LATAM'], copy: `copy ${id}`, claim: `claim ${id}` };
}

describe('GET /api/campaigns + GET /api/campaigns/:id expose advertisements with counts', () => {
  it('lists a campaign with advertisementCount and materialCount', async () => {
    const camp = seedCampaign([
      { id: 'ad-a', name: 'Ad A', materials: [material('m1'), material('m2')] },
      { id: 'ad-b', name: 'Ad B', materials: [material('m3')] },
    ]);

    const list = await json<{ campaigns: Array<{ id: string; advertisementCount: number; materialCount: number }> }>(await app.fetch(req('GET', '/api/campaigns')));
    const entry = list.campaigns.find((x) => x.id === camp.id);
    expect(entry).toBeDefined();
    expect(entry?.advertisementCount).toBe(2);
    expect(entry?.materialCount).toBe(3);

    const detail = await json<{ campaign: { advertisements: Array<{ materials: Array<{ id: string }> }> } }>(await app.fetch(req('GET', `/api/campaigns/${camp.id}`)));
    expect(detail.campaign.advertisements.length).toBe(2);
    expect(detail.campaign.advertisements[0]!.materials.length).toBe(2);
    expect(detail.campaign.advertisements[1]!.materials[0]!.id).toBe('m3');
  });

  it('404s an unknown campaign', async () => {
    const res = await app.fetch(req('GET', '/api/campaigns/does-not-exist'));
    expect(res.status).toBe(404);
  });
});

describe('POST /api/campaigns/:id/advertisements (create, add-anytime)', () => {
  it('appends an advertisement and auto-assigns an id when absent', async () => {
    const camp = seedCampaign([{ id: 'ad-a', name: 'Ad A', materials: [material('m1')] }]);
    const res = await app.fetch(req('POST', `/api/campaigns/${camp.id}/advertisements`, { name: 'Retargeting' }));
    expect(res.status).toBe(200);
    const body = await json<{ advertisement: { id: string; name: string }; campaign: { advertisements: unknown[] } }>(res);
    expect(body.advertisement.name).toBe('Retargeting');
    expect(typeof body.advertisement.id).toBe('string');
    expect(body.campaign.advertisements.length).toBe(2);
    // Persisted.
    const got = store.getCampaign(camp.id);
    expect(got?.advertisements.length).toBe(2);
  });

  it('404s when the campaign does not exist', async () => {
    const res = await app.fetch(req('POST', '/api/campaigns/nope/advertisements', { name: 'X' }));
    expect(res.status).toBe(404);
  });
});

describe('POST .../advertisements/:adId/materials and .../materials (both add-anytime)', () => {
  it('adds a material to the advertisement named in the URL path', async () => {
    const camp = seedCampaign([
      { id: 'ad-a', name: 'Ad A', materials: [] },
      { id: 'ad-b', name: 'Ad B', materials: [] },
    ]);
    const res = await app.fetch(req('POST', `/api/campaigns/${camp.id}/advertisements/ad-b/materials`, material('new-mat', 'image')));
    expect(res.status).toBe(200);
    const body = await json<{ material: { id: string } }>(res);
    expect(body.material.id).toBe('new-mat');
    // It landed in ad-b (the path-addressed ad), not ad-a.
    const got = store.getCampaign(camp.id)!;
    expect(got.advertisements.find((a) => a.id === 'ad-a')?.materials.length).toBe(0);
    expect(got.advertisements.find((a) => a.id === 'ad-b')?.materials.map((m) => m.id)).toEqual(['new-mat']);
  });

  it('404s when the path-addressed advertisement does not exist (no silent fallthrough)', async () => {
    const camp = seedCampaign([{ id: 'ad-a', name: 'Ad A', materials: [] }]);
    const res = await app.fetch(req('POST', `/api/campaigns/${camp.id}/advertisements/ad-missing/materials`, material('x')));
    expect(res.status).toBe(404);
    // Nothing was added.
    expect(store.getCampaign(camp.id)!.advertisements[0]!.materials.length).toBe(0);
  });

  it('body-path /materials targets advertisementId from the body, defaulting to the first ad', async () => {
    const camp = seedCampaign([
      { id: 'ad-a', name: 'Ad A', materials: [] },
      { id: 'ad-b', name: 'Ad B', materials: [] },
    ]);
    // Explicit advertisementId in the body.
    await app.fetch(req('POST', `/api/campaigns/${camp.id}/materials`, { ...material('to-b'), advertisementId: 'ad-b' }));
    // No advertisementId -> first ad (ad-a).
    await app.fetch(req('POST', `/api/campaigns/${camp.id}/materials`, material('to-default')));
    const got = store.getCampaign(camp.id)!;
    expect(got.advertisements.find((a) => a.id === 'ad-b')?.materials.map((m) => m.id)).toEqual(['to-b']);
    expect(got.advertisements.find((a) => a.id === 'ad-a')?.materials.map((m) => m.id)).toEqual(['to-default']);
  });

  it('adds a material AFTER a review has completed (no status gate)', async () => {
    const camp = seedCampaign([{ id: 'ad-a', name: 'Ad A', materials: [material('m1')] }]);
    // Run a full campaign review to completion.
    const start = await json<{ id: string }>(await app.fetch(req('POST', '/api/reviews', { campaignId: camp.id })));
    await waitForCampaignTerminal(start.id);
    // The campaign is reviewed; adding a new advertisement + material must still work.
    const adRes = await app.fetch(req('POST', `/api/campaigns/${camp.id}/advertisements`, { id: 'ad-late', name: 'Late Ad' }));
    expect(adRes.status).toBe(200);
    const matRes = await app.fetch(req('POST', `/api/campaigns/${camp.id}/advertisements/ad-late/materials`, material('late-mat')));
    expect(matRes.status).toBe(200);
    const got = store.getCampaign(camp.id)!;
    expect(got.advertisements.find((a) => a.id === 'ad-late')?.materials.map((m) => m.id)).toEqual(['late-mat']);
  });
});

describe('POST /api/images (multipart image upload)', () => {
  it('hosts an uploaded image and returns its url', async () => {
    const form = new FormData();
    form.set('image', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'pic.png', { type: 'image/png' }));
    const res = await app.fetch(new Request(`${BASE}/api/images`, { method: 'POST', body: form }));
    expect(res.status).toBe(200);
    const body = await json<{ imageUrl: string }>(res);
    expect(typeof body.imageUrl).toBe('string');
    expect(body.imageUrl).toMatch(/^\/api\/images\//);
    // The hosted bytes are served back.
    const name = body.imageUrl.split('/').pop() as string;
    const get = await app.fetch(req('GET', `/api/images/${name}`));
    expect(get.status).toBe(200);
  });

  it('attaches the uploaded image to a material when campaignId + materialId are sent', async () => {
    const camp = seedCampaign([{ id: 'ad-a', name: 'Ad A', materials: [material('img-mat', 'image')] }]);
    const form = new FormData();
    form.set('image', new File([new Uint8Array([1, 2, 3, 4])], 'banner.jpg', { type: 'image/jpeg' }));
    form.set('campaignId', camp.id);
    form.set('materialId', 'img-mat');
    const res = await app.fetch(new Request(`${BASE}/api/images`, { method: 'POST', body: form }));
    const body = await json<{ imageUrl: string }>(res);
    const got = store.getCampaign(camp.id)!;
    const mat = got.advertisements[0]!.materials.find((m) => m.id === 'img-mat')!;
    expect(mat.imageUrl).toBe(body.imageUrl);
  });

  it('400s a request with no image file', async () => {
    const res = await app.fetch(new Request(`${BASE}/api/images`, { method: 'POST', body: new FormData() }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/campaigns/:id/dossier/sources (file upload OR JSON body)', () => {
  it('appends a multipart .md upload to dossier.sources', async () => {
    const camp = seedCampaign([{ id: 'ad-a', name: 'Ad A', materials: [] }]);
    const form = new FormData();
    form.set('file', new File(['# Substantiation\nRCT n=240'], 'evidence.md', { type: 'text/markdown' }));
    const res = await app.fetch(new Request(`${BASE}/api/campaigns/${camp.id}/dossier/sources`, { method: 'POST', body: form }));
    expect(res.status).toBe(200);
    const body = await json<{ source: { kind: string; content: string } }>(res);
    expect(body.source.kind).toBe('md');
    expect(body.source.content).toContain('RCT n=240');
    expect(store.getCampaign(camp.id)!.dossier.sources.map((s) => s.name)).toContain('evidence.md');
  });

  it('appends a JSON-body source { name, kind, content }', async () => {
    const camp = seedCampaign([{ id: 'ad-a', name: 'Ad A', materials: [] }]);
    const res = await app.fetch(
      req('POST', `/api/campaigns/${camp.id}/dossier/sources`, { name: 'data-on-file', kind: 'text', content: 'DF-2026-07' }),
    );
    expect(res.status).toBe(200);
    const got = store.getCampaign(camp.id)!;
    expect(got.dossier.sources.find((s) => s.name === 'data-on-file')?.content).toBe('DF-2026-07');
  });

  it('the legacy /dossier-sources alias still appends (multipart)', async () => {
    const camp = seedCampaign([{ id: 'ad-a', name: 'Ad A', materials: [] }]);
    const form = new FormData();
    form.set('file', new File(['{"k":1}'], 'facts.json', { type: 'application/json' }));
    const res = await app.fetch(new Request(`${BASE}/api/campaigns/${camp.id}/dossier-sources`, { method: 'POST', body: form }));
    expect(res.status).toBe(200);
    expect(store.getCampaign(camp.id)!.dossier.sources.find((s) => s.name === 'facts.json')?.kind).toBe('json');
  });

  it('400s a JSON body with no content', async () => {
    const camp = seedCampaign([{ id: 'ad-a', name: 'Ad A', materials: [] }]);
    const res = await app.fetch(req('POST', `/api/campaigns/${camp.id}/dossier/sources`, { name: 'empty' }));
    expect(res.status).toBe(400);
  });
});

// --- Campaign review: traverse advertisements -> materials, SSE carries ids ----

/** Read a campaign-review SSE stream to completion, returning the parsed events. */
async function readCampaignSse(id: string): Promise<BoardEvent[]> {
  const res = await app.fetch(req('GET', `/api/campaign-reviews/${id}/events`));
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events: BoardEvent[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data:')) events.push(JSON.parse(line.slice(5).trim()) as BoardEvent);
      }
    }
  }
  return events;
}

/** Poll the campaign-review GET until it leaves the running state. */
async function waitForCampaignTerminal(id: string): Promise<{ status: string; rollup: unknown; events: BoardEvent[] }> {
  for (let i = 0; i < 400; i++) {
    const body = await json<{ status: string; rollup: unknown; events: BoardEvent[] }>(await app.fetch(req('GET', `/api/campaign-reviews/${id}`)));
    if (body.status && body.status !== 'running') return body;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`campaign review ${id} did not terminate`);
}

describe('campaign review traverses advertisements -> materials; SSE + rollup', () => {
  it('starts a review over all ads/materials, tags every per-material event with adId+materialId, and returns the per-ad + campaign rollup', async () => {
    const camp = seedCampaign([
      { id: 'ad-hero', name: 'Hero', materials: [material('hero-a'), material('hero-b')] },
      { id: 'ad-promo', name: 'Promo', materials: [material('promo-a')] },
    ]);

    const start = await json<{ id: string; kind: string; materials: string[] }>(await app.fetch(req('POST', '/api/reviews', { campaignId: camp.id })));
    expect(start.kind).toBe('campaign');
    expect(new Set(start.materials)).toEqual(new Set(['hero-a', 'hero-b', 'promo-a']));

    // Drain the SSE stream (it self-closes on the campaign-level terminal status).
    const events = await readCampaignSse(start.id);

    // Every per-material event (anything tagged with a materialId) also carries the
    // advertisement it belongs to, and the pairing is correct.
    const adByMaterial: Record<string, string> = { 'hero-a': 'ad-hero', 'hero-b': 'ad-hero', 'promo-a': 'ad-promo' };
    const tagged = events.filter((e) => e.materialId !== undefined);
    expect(tagged.length).toBeGreaterThan(0);
    for (const e of tagged) {
      expect(e.campaignId).toBe(camp.id);
      expect(e.advertisementId).toBe(adByMaterial[e.materialId!]);
    }
    // All three materials produced an intake (they were all traversed).
    const intaken = new Set(events.filter((e) => e.type === 'intake' && e.materialId).map((e) => e.materialId));
    expect(intaken).toEqual(new Set(['hero-a', 'hero-b', 'promo-a']));

    // The non-SSE GET returns the new computeRollup shape (per-ad + per-campaign).
    const final = await waitForCampaignTerminal(start.id);
    const rollup = final.rollup as {
      campaignId: string;
      worstCaseByRegion: Array<{ region: string; decision: string }>;
      perAdvertisement: Array<{ advertisementId: string; name: string; worstCaseByRegion: unknown[]; matrix: unknown[] }>;
      matrix: Array<{ advertisementId: string; materialId: string; region: string }>;
    };
    expect(rollup.campaignId).toBe(camp.id);
    expect(rollup.perAdvertisement.map((a) => a.advertisementId).sort()).toEqual(['ad-hero', 'ad-promo']);
    // 3 materials x 4 regions (US/EU/LATAM/BRAND) = 12 campaign matrix cells, each ad-tagged.
    expect(rollup.matrix.length).toBe(12);
    expect(rollup.matrix.every((cell) => cell.advertisementId === adByMaterial[cell.materialId])).toBe(true);
    // With the key-free demo stubs these arbitrary materials have no findings -> publish everywhere.
    expect(rollup.worstCaseByRegion.every((r) => r.decision === 'publish')).toBe(true);
  });

  it('404s a campaign review id that does not exist', async () => {
    const res = await app.fetch(req('GET', '/api/campaign-reviews/nope'));
    expect(res.status).toBe(404);
  });

  it('rejects a campaign with no materials', async () => {
    const camp = seedCampaign([{ id: 'ad-empty', name: 'Empty', materials: [] }]);
    const res = await app.fetch(req('POST', '/api/reviews', { campaignId: camp.id }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/reviews scoped to ONE advertisement (advertisementId)', () => {
  it('reviews ONLY the scoped ad\'s materials; SSE + rollup cover just that ad', async () => {
    const camp = seedCampaign([
      { id: 'ad-hero', name: 'Hero', materials: [material('hero-a'), material('hero-b')] },
      { id: 'ad-promo', name: 'Promo', materials: [material('promo-a')] },
    ]);

    const start = await json<{ id: string; kind: string; advertisementId?: string; materials: string[] }>(
      await app.fetch(req('POST', '/api/reviews', { campaignId: camp.id, advertisementId: 'ad-promo' })),
    );
    expect(start.kind).toBe('campaign');
    expect(start.advertisementId).toBe('ad-promo');
    // Only the scoped ad's materials are announced (hero-a/hero-b excluded).
    expect(new Set(start.materials)).toEqual(new Set(['promo-a']));

    const events = await readCampaignSse(start.id);
    // Only promo-a was intaken; the Hero ad's materials were never touched.
    const intaken = new Set(events.filter((e) => e.type === 'intake' && e.materialId).map((e) => e.materialId));
    expect(intaken).toEqual(new Set(['promo-a']));
    expect(events.some((e) => e.materialId === 'hero-a' || e.materialId === 'hero-b')).toBe(false);
    // Every ad-tagged event points at the scoped advertisement.
    expect(events.filter((e) => e.advertisementId !== undefined).every((e) => e.advertisementId === 'ad-promo')).toBe(true);

    const final = await waitForCampaignTerminal(start.id);
    const rollup = final.rollup as {
      perAdvertisement: Array<{ advertisementId: string }>;
      matrix: Array<{ advertisementId: string; materialId: string }>;
    };
    // The rollup covers ONLY the scoped advertisement (1 material x 4 regions = 4 cells).
    expect(rollup.perAdvertisement.map((a) => a.advertisementId)).toEqual(['ad-promo']);
    expect(rollup.matrix.length).toBe(4);
    expect(rollup.matrix.every((cell) => cell.advertisementId === 'ad-promo')).toBe(true);
  });

  it('404s when the advertisementId is not in the campaign (and starts no review)', async () => {
    const camp = seedCampaign([{ id: 'ad-hero', name: 'Hero', materials: [material('hero-a')] }]);
    const res = await app.fetch(req('POST', '/api/reviews', { campaignId: camp.id, advertisementId: 'ad-missing' }));
    expect(res.status).toBe(404);
  });

  it('400s when the scoped advertisement has no materials', async () => {
    const camp = seedCampaign([
      { id: 'ad-full', name: 'Full', materials: [material('m1')] },
      { id: 'ad-empty', name: 'Empty', materials: [] },
    ]);
    const res = await app.fetch(req('POST', '/api/reviews', { campaignId: camp.id, advertisementId: 'ad-empty' }));
    expect(res.status).toBe(400);
  });

  it('an unscoped campaign review still reviews EVERY ad\'s materials (control)', async () => {
    const camp = seedCampaign([
      { id: 'ad-hero', name: 'Hero', materials: [material('hero-a'), material('hero-b')] },
      { id: 'ad-promo', name: 'Promo', materials: [material('promo-a')] },
    ]);
    const start = await json<{ id: string; materials: string[] }>(await app.fetch(req('POST', '/api/reviews', { campaignId: camp.id })));
    expect(new Set(start.materials)).toEqual(new Set(['hero-a', 'hero-b', 'promo-a']));
    const events = await readCampaignSse(start.id);
    const intaken = new Set(events.filter((e) => e.type === 'intake' && e.materialId).map((e) => e.materialId));
    expect(intaken).toEqual(new Set(['hero-a', 'hero-b', 'promo-a']));
    const final = await waitForCampaignTerminal(start.id);
    const rollup = final.rollup as { perAdvertisement: Array<{ advertisementId: string }> };
    expect(rollup.perAdvertisement.map((a) => a.advertisementId).sort()).toEqual(['ad-hero', 'ad-promo']);
  });
});


// --- POST /api/videos: host the upload AND transcribe at upload time ----------
// In this suite KEY_FREE_LOCAL is on (no AIML key), so the server's perception STT
// is the deterministic demo StubSttClient. Uploading a real clip WITH an audio
// track therefore yields a canned transcript that is PERSISTED on the material, so
// GET /api/campaigns/:id returns it. A clip with NO audio (or no ffmpeg) leaves the
// transcript empty but the upload still succeeds (graceful degradation).

const DEMO_STUB_TRANSCRIPT =
  'Feeling run down? Northwind Immune plus helps maintain your immune response so you can feel your best, every day. Nine out of ten users felt the difference in two weeks. As part of a varied, balanced diet and a healthy lifestyle.';

function uploadVideo(bytes: Uint8Array, filename: string, fields: Record<string, string> = {}): Request {
  const form = new FormData();
  form.set('video', new File([bytes], filename, { type: 'video/mp4' }));
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new Request(`${BASE}/api/videos`, { method: 'POST', body: form });
}

describe('POST /api/videos hosts the upload and transcribes onto the material', () => {
  it('attaches videoUrl AND persists perception.transcript (GET /api/campaigns returns it)', async () => {
    const camp = seedCampaign([{ id: 'ad-a', name: 'Ad A', materials: [material('vid-mat', 'video')] }]);
    if (!hasFfmpeg || !toneMp4) {
      // No ffmpeg: at least prove the upload succeeds and attaches the videoUrl.
      const res = await app.fetch(uploadVideo(new Uint8Array([1, 2, 3, 4]), 'clip.mp4', { campaignId: camp.id, materialId: 'vid-mat' }));
      expect(res.status).toBe(200);
      const got = store.getCampaign(camp.id)!;
      const mat = got.advertisements[0]!.materials.find((m) => m.id === 'vid-mat')!;
      expect(typeof mat.videoUrl).toBe('string');
      return;
    }
    const res = await app.fetch(uploadVideo(toneMp4, 'clip.mp4', { campaignId: camp.id, materialId: 'vid-mat' }));
    expect(res.status).toBe(200);
    const body = await json<{ videoUrl: string; transcribed: boolean }>(res);
    expect(body.videoUrl).toMatch(/^\/api\/videos\//);
    expect(body.transcribed).toBe(true);

    // The transcript is PERSISTED: a fresh GET /api/campaigns/:id returns it.
    const detail = await json<{ campaign: { advertisements: Array<{ materials: Array<{ id: string; videoUrl?: string; perception?: { transcript?: string } }> }> } }>(
      await app.fetch(req('GET', `/api/campaigns/${camp.id}`)),
    );
    const mat = detail.campaign.advertisements[0]!.materials.find((m) => m.id === 'vid-mat')!;
    expect(mat.videoUrl).toBe(body.videoUrl);
    expect(mat.perception?.transcript).toBe(DEMO_STUB_TRANSCRIPT);
  });

  it('a clip with NO audio track persists the videoUrl with an empty transcript (no crash)', async () => {
    if (!hasFfmpeg || !silentMp4) return;
    const camp = seedCampaign([{ id: 'ad-a', name: 'Ad A', materials: [material('silent-mat', 'video')] }]);
    const res = await app.fetch(uploadVideo(silentMp4, 'silent.mp4', { campaignId: camp.id, materialId: 'silent-mat' }));
    expect(res.status).toBe(200);
    const body = await json<{ transcribed: boolean }>(res);
    expect(body.transcribed).toBe(false);
    const got = store.getCampaign(camp.id)!;
    const mat = got.advertisements[0]!.materials.find((m) => m.id === 'silent-mat')!;
    expect(typeof mat.videoUrl).toBe('string'); // upload still succeeded
    expect(mat.perception?.transcript ?? '').toBe(''); // no audio => empty transcript
  });

  it('uploads with no campaign/material coordinates still host the video (no transcription)', async () => {
    const res = await app.fetch(uploadVideo(toneMp4 ?? new Uint8Array([1, 2, 3, 4]), 'loose.mp4'));
    expect(res.status).toBe(200);
    const body = await json<{ videoUrl: string; transcribed: boolean }>(res);
    expect(body.videoUrl).toMatch(/^\/api\/videos\//);
    expect(body.transcribed).toBe(false); // no material to attach a transcript to
  });

  it('400s an empty video file', async () => {
    const res = await app.fetch(uploadVideo(new Uint8Array(0), 'empty.mp4'));
    expect(res.status).toBe(400);
  });
});
