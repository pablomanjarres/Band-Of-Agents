// HTTP + SSE backend for the campaign portal. Reuses the domain, agents, and
// model routing in src/. A POST submits a campaign; the console subscribes over
// SSE and watches the review stream in live.
//
//   pnpm serve                       (BOARD_MODE=band, the product: a real band.ai room)
//   BOARD_MODE=local pnpm serve      (in-process transport; dev/offline fallback)
//
// In band mode the Intake agent creates a real band.ai room, adds the reviewer
// agents, and posts the campaign; the agents collaborate in band.ai and the
// server only observes. A small file-backed Store persists reviews, the
// precedent log, the asset library, and per-region rulebook overrides.

import 'dotenv/config';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { loadBrandDna, loadRulebook } from '../domain/load';
import { Campaign as CampaignSchema, ContentAsset as ContentAssetSchema, Material as MaterialSchema, Rulebook as RulebookSchema } from '../domain/types';
import type { Campaign, ContentAsset, Rulebook } from '../domain/types';
import { BoardSession, realBoardModels } from '../board/session';
import { CampaignSession, type CampaignRollup } from '../board/campaign';
import { BandBoard } from '../board/band-session';
import { modelFor } from '../models/route';
import { importRulebook, type ImportFormat } from '../domain/rulebook-import';
import { loadPresets } from '../domain/presets';
import type { BoardEvent, BoardStatus } from '../board/events';
import { Store } from '../store/store';

const ASSETS = new URL('../../assets/', import.meta.url).pathname;
const PRESETS_DIR = new URL('../../assets/presets/', import.meta.url).pathname;
const WEB_DIST = new URL('../../web/dist/', import.meta.url).pathname;
const DATA_DIR = new URL('../../data/', import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 8787);
const BOARD_MODE = process.env.BOARD_MODE === 'local' ? 'local' : 'band';
const REGIONS = ['us', 'eu', 'latam'] as const;
type RegionKey = (typeof REGIONS)[number];

interface ReviewRecord {
  id: string;
  createdAt: number;
  asset: ContentAsset;
  events: BoardEvent[];
  status: BoardStatus;
  conflict: boolean;
  subscribers: Set<(event: BoardEvent) => void>;
  submitDecision: (text: string) => Promise<void>;
}

// A campaign review is ONE id under which every material's events stream (each
// event carries materialId, so the UI lanes them). The rollup is recomputed as
// verdicts arrive; it is observational and gates nothing (the one rule).
interface CampaignReviewRecord {
  id: string;
  createdAt: number;
  campaign: Campaign;
  events: BoardEvent[];
  status: BoardStatus;
  conflict: boolean;
  rollup: CampaignRollup | null;
  subscribers: Set<(event: BoardEvent) => void>;
  submitDecision: (materialId: string, text: string) => Promise<void>;
}

const reviews = new Map<string, ReviewRecord>();
const campaignReviews = new Map<string, CampaignReviewRecord>();
const store = new Store(DATA_DIR);

// Feed recent human-decision precedents back into the reviewers' shared context.
const recentPrecedents = (): string[] =>
  store.listPrecedents().slice(-6).map((p) => `${p.regions.join('/')}: ${p.decision}`);

const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
const defaultRulebooks: Record<RegionKey, Rulebook> = {
  us: loadRulebook(`${ASSETS}rulebook.us.json`),
  eu: loadRulebook(`${ASSETS}rulebook.eu.json`),
  latam: loadRulebook(`${ASSETS}rulebook.latam.json`),
};

function currentRulebooks(): Record<RegionKey, Rulebook> {
  return {
    us: store.getRulebookOverride('US') ?? defaultRulebooks.us,
    eu: store.getRulebookOverride('EU') ?? defaultRulebooks.eu,
    latam: store.getRulebookOverride('LATAM') ?? defaultRulebooks.latam,
  };
}

// The model used to parse a freeform (.md/text) rulebook into structured rules.
// AIML is the default route (MODEL_MODE); we reuse the EU reviewer's slot because
// it is a strong, strict structured-output model. No new model ids are added.
function importModel() {
  return modelFor('eu');
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Resolve a human's free-text reference ("review campaign Immune+ Q3") to a saved campaign.
function findCampaign(query: string): ContentAsset | undefined {
  const q = normalizeName(query);
  if (!q) return undefined;
  return store.listAssets().find((a) => {
    const name = a.name ? normalizeName(a.name) : '';
    return name.length > 0 && q.includes(name);
  });
}

// A review just started in a band.ai room: create its record and return the event sink.
function registerDiscoveredReview(roomId: string): (event: BoardEvent) => void {
  const record: ReviewRecord = {
    id: roomId,
    createdAt: Date.now(),
    asset: { id: `room-${roomId.slice(0, 8)}`, channel: '', markets: [], copy: '', claim: '' },
    events: [],
    status: 'running',
    conflict: false,
    subscribers: new Set(),
    submitDecision: async () => {},
  };
  reviews.set(roomId, record);
  return makeOnEvent(record);
}

// band mode: connect the agents (you add them in app.band.ai) and OBSERVE. We never create rooms.
const bandBoard =
  BOARD_MODE === 'band'
    ? new BandBoard({
        brand,
        rulebooks: currentRulebooks(),
        models: realBoardModels(),
        ...(process.env.HUMAN_HANDLE ? { humanHandle: process.env.HUMAN_HANDLE } : {}),
        hostImage: (u) => store.hostImage(u) ?? u,
        getPrecedents: recentPrecedents,
        getRulebook: (region) => store.getRulebookOverride(region) ?? defaultRulebooks[region.toLowerCase() as RegionKey] ?? defaultRulebooks.us,
        lookupCampaign: findCampaign,
        logPrecedent: (p) => store.appendPrecedent(p),
        onReviewDiscovered: registerDiscoveredReview,
      })
    : undefined;

const CreateReview = z.object({
  copy: z.string().min(1),
  claim: z.string().min(1),
  channel: z.string().min(1).default('instagram'),
  markets: z.array(z.string()).min(1),
  imagePrompt: z.string().optional(),
  substantiation: z.string().optional(),
});

function imageContentType(name: string): string {
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

function makeOnEvent(record: ReviewRecord): (event: BoardEvent) => void {
  return (event) => {
    let e = event;
    // Host generated images out of the event stream so stored/streamed payloads stay small.
    if (e.type === 'revised' && e.imageUrl) {
      const hosted = store.hostImage(e.imageUrl);
      if (hosted) e = { ...e, imageUrl: hosted };
    }
    e = { ...e, seq: record.events.length } as BoardEvent;
    record.events.push(e);
    if (e.type === 'intake') record.asset = e.asset;
    if (e.type === 'verdict' && e.conflict) record.conflict = true;
    if (e.type === 'status') {
      record.status = e.status;
      if (e.status !== 'running') {
        store.saveReview({ id: record.id, createdAt: record.createdAt, asset: record.asset, events: record.events, status: record.status, conflict: record.conflict });
      }
    }
    for (const sub of record.subscribers) sub(e);
  };
}

// Campaign event sink: every per-material event is image-hosted, seq-stamped, and
// fanned out under the single campaign-review id. Per-material status events keep
// their materialId so the UI lanes them and the campaign SSE does NOT close on
// them; the campaign-level terminal is a separate status event with no materialId.
function makeCampaignOnEvent(record: CampaignReviewRecord): (event: BoardEvent) => void {
  return (event) => {
    let e = event;
    if (e.type === 'revised' && e.imageUrl) {
      const hosted = store.hostImage(e.imageUrl);
      if (hosted) e = { ...e, imageUrl: hosted };
    }
    e = { ...e, seq: record.events.length } as BoardEvent;
    record.events.push(e);
    if (e.type === 'verdict' && e.conflict) record.conflict = true;
    for (const sub of record.subscribers) sub(e);
  };
}

// Run a campaign as concurrent per-material reviews. Returns the record id; the
// caller streams events over SSE. The campaign status stays 'running' until every
// material is terminal (CampaignSession.run resolves), then becomes 'complete' or
// 'awaiting-decision' (any material escalated) and a campaign-level status event
// is emitted (no materialId) so the SSE consumer knows the whole campaign rested.
function runCampaignReview(campaign: Campaign): string {
  const id = randomUUID();
  const record: CampaignReviewRecord = {
    id,
    createdAt: Date.now(),
    campaign,
    events: [],
    status: 'running',
    conflict: false,
    rollup: null,
    subscribers: new Set(),
    submitDecision: async () => {},
  };
  const onEvent = makeCampaignOnEvent(record);
  campaignReviews.set(id, record);

  // Build the models and run inside the async flow so a missing key / provider
  // failure degrades THIS review to a status:error event (mirroring the single-
  // asset path that returns {id} then fails async), never a 500 or a dead portal.
  void (async () => {
    try {
      const session = new CampaignSession({
        roomId: `campaign-${id}`,
        campaign,
        brand,
        rulebooks: currentRulebooks(),
        models: realBoardModels(),
        onEvent: (e) => {
          onEvent(e);
          record.rollup = session.rollup();
        },
        onPrecedent: (precedent) => store.appendPrecedent(precedent),
        hostImage: (u) => store.hostImage(u) ?? u,
        getPrecedents: recentPrecedents,
      });
      record.submitDecision = (materialId, text) => session.submitDecision(materialId, text);
      const rollup = await session.run();
      record.rollup = rollup;
      const escalated = rollup.worstCaseByRegion.some((r) => r.decision === 'escalate');
      record.status = escalated ? 'awaiting-decision' : 'complete';
      onEvent({ type: 'status', seq: 0, fromName: 'system', status: record.status });
    } catch (err: unknown) {
      record.status = 'error';
      onEvent({ type: 'log', seq: 0, fromName: 'system', messageType: 'error', text: `Campaign review failed: ${(err as Error)?.message ?? String(err)}` });
      onEvent({ type: 'status', seq: 0, fromName: 'system', status: 'error' });
    }
  })();
  return id;
}

// A model/provider failure should degrade a single review, never take down the
// portal (e.g. an expired Vertex token surfacing as an async rejection).
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandled rejection (continuing):', (reason as Error)?.message ?? String(reason));
});

const app = new Hono();
app.use('/api/*', cors());

app.post('/api/reviews', async (c) => {
  if (BOARD_MODE === 'band') {
    return c.json(
      { error: 'In band mode, start reviews from band.ai: post "Coordinator, review campaign <name>" in your room. Compose/save campaigns via POST /api/assets.' },
      400,
    );
  }
  const body: unknown = await c.req.json().catch(() => ({}));

  // Campaign mode: a saved campaignId or an inline campaign runs every material
  // concurrently. The single-asset payload below is unchanged (no regression).
  const b = (body ?? {}) as { campaignId?: unknown; campaign?: unknown };
  if (typeof b.campaignId === 'string' || (b.campaign && typeof b.campaign === 'object')) {
    let campaign: Campaign | undefined;
    if (typeof b.campaignId === 'string') {
      campaign = store.getCampaign(b.campaignId);
      if (!campaign) return c.json({ error: `campaign ${b.campaignId} not found` }, 404);
    } else {
      const parsedCampaign = CampaignSchema.safeParse(b.campaign);
      if (!parsedCampaign.success) return c.json({ error: parsedCampaign.error.flatten() }, 400);
      campaign = parsedCampaign.data;
    }
    if (campaign.materials.length === 0) return c.json({ error: 'campaign has no materials' }, 400);
    const id = runCampaignReview(campaign);
    return c.json({ id, kind: 'campaign', materials: campaign.materials.map((m) => m.id) });
  }

  const parsed = CreateReview.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const d = parsed.data;
  const asset: ContentAsset = {
    id: `asset-${randomUUID().slice(0, 8)}`,
    channel: d.channel,
    markets: d.markets,
    copy: d.copy,
    claim: d.claim,
    ...(d.imagePrompt ? { imagePrompt: d.imagePrompt } : {}),
    ...(d.substantiation ? { substantiation: d.substantiation } : {}),
  };

  const record: ReviewRecord = {
    id: '',
    createdAt: Date.now(),
    asset,
    events: [],
    status: 'running',
    conflict: false,
    subscribers: new Set(),
    submitDecision: async () => {},
  };
  const onEvent = makeOnEvent(record);

  const id = randomUUID();
  record.id = id;
  const session = new BoardSession({
    roomId: `review-${id}`,
    asset,
    brand,
    rulebooks: currentRulebooks(),
    models: realBoardModels(),
    onEvent,
    onPrecedent: (p) => store.appendPrecedent(p),
    hostImage: (u) => store.hostImage(u) ?? u,
    getPrecedents: recentPrecedents,
  });
  record.submitDecision = (text) => session.submitDecision(text);
  reviews.set(id, record);
  void session.run().catch((err: unknown) => {
    onEvent({ type: 'log', seq: 0, fromName: 'system', messageType: 'error', text: `Review failed: ${(err as Error)?.message ?? String(err)}` });
    onEvent({ type: 'status', seq: 0, fromName: 'system', status: 'error' });
  });
  return c.json({ id });
});

app.get('/api/reviews', (c) => {
  const byId = new Map<string, { id: string; createdAt: number; assetId: string; copy: string; markets: string[]; status: BoardStatus; conflict: boolean }>();
  for (const r of store.listReviews()) {
    byId.set(r.id, { id: r.id, createdAt: r.createdAt, assetId: r.asset.id, copy: r.asset.copy, markets: r.asset.markets, status: r.status, conflict: r.conflict });
  }
  for (const r of reviews.values()) {
    byId.set(r.id, { id: r.id, createdAt: r.createdAt, assetId: r.asset.id, copy: r.asset.copy, markets: r.asset.markets, status: r.status, conflict: r.conflict });
  }
  const list = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
  return c.json({ reviews: list, mode: BOARD_MODE });
});

app.get('/api/reviews/:id', (c) => {
  const id = c.req.param('id');
  const record = reviews.get(id);
  if (record) return c.json({ id: record.id, status: record.status, asset: record.asset, events: record.events });
  const stored = store.getReview(id);
  if (!stored) return c.json({ error: 'not found' }, 404);
  return c.json({ id: stored.id, status: stored.status, asset: stored.asset, events: stored.events });
});

app.get('/api/reviews/:id/events', (c) => {
  const id = c.req.param('id');
  const record = reviews.get(id);
  if (!record) {
    const stored = store.getReview(id);
    if (!stored) return c.json({ error: 'not found' }, 404);
    return streamSSE(c, async (stream) => {
      for (const event of stored.events) await stream.writeSSE({ data: JSON.stringify(event) });
    });
  }
  return streamSSE(c, async (stream) => {
    for (const event of record.events) await stream.writeSSE({ data: JSON.stringify(event) });
    if (record.status === 'complete' || record.status === 'error') return;

    const queue: BoardEvent[] = [];
    let wake: (() => void) | null = null;
    const sub = (event: BoardEvent): void => {
      queue.push(event);
      if (wake) {
        wake();
        wake = null;
      }
    };
    record.subscribers.add(sub);
    try {
      for (;;) {
        if (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve));
        const event = queue.shift();
        if (!event) continue;
        await stream.writeSSE({ data: JSON.stringify(event) });
        if (event.type === 'status' && (event.status === 'complete' || event.status === 'error')) break;
      }
    } finally {
      record.subscribers.delete(sub);
    }
  });
});

app.post('/api/reviews/:id/decision', async (c) => {
  const record = reviews.get(c.req.param('id'));
  if (!record) return c.json({ error: 'not found' }, 404);
  const body: unknown = await c.req.json().catch(() => ({}));
  const decision = typeof (body as { decision?: unknown })?.decision === 'string' ? (body as { decision: string }).decision : '';
  if (!decision) return c.json({ error: 'decision required' }, 400);
  void record.submitDecision(decision).catch(() => {});
  return c.json({ ok: true });
});

app.get('/api/images/:name', (c) => {
  const buf = store.readImage(c.req.param('name'));
  if (!buf) return c.json({ error: 'not found' }, 404);
  return c.body(new Uint8Array(buf), 200, { 'content-type': imageContentType(c.req.param('name')), 'cache-control': 'public, max-age=31536000, immutable' });
});

app.get('/api/precedents', (c) => c.json({ precedents: store.listPrecedents() }));

app.get('/api/assets', (c) => c.json({ assets: store.listAssets() }));

app.post('/api/assets', async (c) => {
  const body: unknown = await c.req.json().catch(() => ({}));
  const candidate = (body as { id?: unknown })?.id ? body : { ...(body as object), id: `asset-${randomUUID().slice(0, 8)}` };
  const parsed = ContentAssetSchema.safeParse(candidate);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  store.saveAsset(parsed.data);
  return c.json({ asset: parsed.data });
});

// --- Campaigns -----------------------------------------------------------
// The saved campaign library. listCampaigns also surfaces legacy single assets
// as one-material campaigns, so existing data still appears (store back-compat).

app.get('/api/campaigns', (c) => {
  const list = store
    .listCampaigns()
    .map((camp) => ({ id: camp.id, name: camp.name, markets: camp.markets, materialCount: camp.materials.length }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return c.json({ campaigns: list });
});

app.get('/api/campaigns/:id', (c) => {
  const camp = store.getCampaign(c.req.param('id'));
  if (!camp) return c.json({ error: 'not found' }, 404);
  return c.json({ campaign: camp });
});

app.post('/api/campaigns', async (c) => {
  const body: unknown = await c.req.json().catch(() => ({}));
  const candidate = (body as { id?: unknown })?.id ? body : { ...(body as object), id: `camp-${randomUUID().slice(0, 8)}` };
  const parsed = CampaignSchema.safeParse(candidate);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  store.saveCampaign(parsed.data);
  return c.json({ campaign: parsed.data });
});

// Add a material to an existing campaign (id auto-assigned when absent).
app.post('/api/campaigns/:id/materials', async (c) => {
  const camp = store.getCampaign(c.req.param('id'));
  if (!camp) return c.json({ error: 'not found' }, 404);
  const body: unknown = await c.req.json().catch(() => ({}));
  const candidate = (body as { id?: unknown })?.id ? body : { ...(body as object), id: `mat-${randomUUID().slice(0, 8)}` };
  const parsed = MaterialSchema.safeParse(candidate);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const next = { ...camp, materials: [...camp.materials.filter((m) => m.id !== parsed.data.id), parsed.data] };
  store.saveCampaign(next);
  return c.json({ campaign: next, material: parsed.data });
});

// Campaign review state for the UI: status, the observational rollup (worst-case
// per region + the material x region matrix), and the full event stream.
app.get('/api/campaign-reviews/:id', (c) => {
  const record = campaignReviews.get(c.req.param('id'));
  if (!record) return c.json({ error: 'not found' }, 404);
  return c.json({
    id: record.id,
    status: record.status,
    campaign: record.campaign,
    rollup: record.rollup,
    events: record.events,
  });
});

app.get('/api/campaign-reviews/:id/events', (c) => {
  const id = c.req.param('id');
  const record = campaignReviews.get(id);
  if (!record) return c.json({ error: 'not found' }, 404);
  return streamSSE(c, async (stream) => {
    for (const event of record.events) await stream.writeSSE({ data: JSON.stringify(event) });
    if (record.status === 'complete' || record.status === 'error') return;

    const queue: BoardEvent[] = [];
    let wake: (() => void) | null = null;
    const sub = (event: BoardEvent): void => {
      queue.push(event);
      if (wake) {
        wake();
        wake = null;
      }
    };
    record.subscribers.add(sub);
    try {
      for (;;) {
        if (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve));
        const event = queue.shift();
        if (!event) continue;
        await stream.writeSSE({ data: JSON.stringify(event) });
        // Only a campaign-level terminal (no materialId) closes the stream; a
        // per-material status event keeps it open so the other lanes keep flowing.
        if (event.type === 'status' && event.materialId === undefined && (event.status === 'complete' || event.status === 'error')) break;
      }
    } finally {
      record.subscribers.delete(sub);
    }
  });
});

// A human ruling on one material's escalation inside a campaign review.
app.post('/api/campaign-reviews/:id/decision', async (c) => {
  const record = campaignReviews.get(c.req.param('id'));
  if (!record) return c.json({ error: 'not found' }, 404);
  const body: unknown = await c.req.json().catch(() => ({}));
  const materialId = typeof (body as { materialId?: unknown })?.materialId === 'string' ? (body as { materialId: string }).materialId : '';
  const decision = typeof (body as { decision?: unknown })?.decision === 'string' ? (body as { decision: string }).decision : '';
  if (!materialId || !decision) return c.json({ error: 'materialId and decision required' }, 400);
  void record.submitDecision(materialId, decision).catch(() => {});
  return c.json({ ok: true });
});

app.get('/api/rulebooks', (c) => {
  const current = currentRulebooks();
  return c.json({ rulebooks: REGIONS.map((r) => current[r]) });
});

// Curated one-click rulebook presets (US-FTC, EU health claims, LATAM). Read-only;
// the picked preset is applied via the existing PUT /api/rulebooks/:region.
app.get('/api/rulebooks/presets', (c) => {
  const presets = loadPresets(PRESETS_DIR).map((p) => ({ id: p.id, label: p.label, region: p.region, rulebook: p.rulebook }));
  return c.json({ presets });
});

app.get('/api/rulebooks/:region', (c) => {
  const region = c.req.param('region').toLowerCase();
  if (!(REGIONS as readonly string[]).includes(region)) return c.json({ error: 'unknown region' }, 404);
  return c.json({ rulebook: currentRulebooks()[region as RegionKey] });
});

app.put('/api/rulebooks/:region', async (c) => {
  const region = c.req.param('region').toLowerCase();
  if (!(REGIONS as readonly string[]).includes(region)) return c.json({ error: 'unknown region' }, 404);
  const body: unknown = await c.req.json().catch(() => ({}));
  const parsed = RulebookSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  store.saveRulebookOverride(region, parsed.data);
  return c.json({ rulebook: parsed.data });
});

// Smart rulebook import. The result is a PROPOSAL for the user to confirm: it is
// NOT persisted here. The user reviews the returned rulebook and saves it with
// the PUT above. json => validate the content directly (no model call). md/text
// => parse with the AIML-default model into structured Rule[] (the same
// structured-output path the reviewers use), honoring MODEL_MODE.
const ImportBody = z.object({
  format: z.enum(['md', 'json', 'text']),
  content: z.string().min(1),
  label: z.string().optional(),
});

app.post('/api/rulebooks/:region/import', async (c) => {
  const region = c.req.param('region').toLowerCase();
  if (!(REGIONS as readonly string[]).includes(region)) return c.json({ error: 'unknown region' }, 404);
  const body: unknown = await c.req.json().catch(() => ({}));
  const parsed = ImportBody.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const { format, content, label } = parsed.data;
  try {
    const rulebook = await importRulebook({
      format: format as ImportFormat,
      content,
      region,
      ...(label ? { label } : {}),
      // The model is only constructed for md/text; a json import never calls it.
      ...(format === 'json' ? {} : { model: importModel() }),
    });
    return c.json({ rulebook });
  } catch (err: unknown) {
    return c.json({ error: (err as Error)?.message ?? 'rulebook import failed' }, 400);
  }
});

if (existsSync(WEB_DIST)) {
  app.use('/*', serveStatic({ root: './web/dist' }));
  app.get('*', serveStatic({ path: './web/dist/index.html' }));
} else {
  app.get('/', (c) =>
    c.text('Campaign portal backend is running. Build the UI: cd web && pnpm install && pnpm build, or run cd web && pnpm dev. API is under /api.'),
  );
}

async function main(): Promise<void> {
  if (bandBoard) {
    console.log('Connecting band.ai agents (BOARD_MODE=band). This is the real coordination layer...');
    await bandBoard.start();
    console.log('band.ai agents connected and waiting for campaigns.');
  }
  serve({ fetch: app.fetch, port: PORT });
  console.log(`Campaign portal on http://localhost:${PORT} (BOARD_MODE=${BOARD_MODE}, MODEL_MODE=${process.env.MODEL_MODE ?? 'aiml'})`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
