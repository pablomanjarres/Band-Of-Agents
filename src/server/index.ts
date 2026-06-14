// HTTP + SSE backend for the compliance console. Reuses the domain, agents, and
// model routing in src/. A POST starts a BoardSession (in-process, real models);
// the console subscribes over SSE and watches the review stream in live.
//
//   pnpm serve            (BOARD_MODE=local: FakeBandTransport + real models)
//
// Build the web app first (cd web && pnpm install && pnpm build) to serve the UI
// from this process, or run `cd web && pnpm dev` and let Vite proxy /api here.

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
import type { ContentAsset } from '../domain/types';
import { BoardSession, realBoardModels } from '../board/session';
import type { BoardEvent, BoardStatus } from '../board/events';

const ASSETS = new URL('../../assets/', import.meta.url).pathname;
const WEB_DIST = new URL('../../web/dist/', import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 8787);

interface ReviewRecord {
  id: string;
  createdAt: number;
  asset: ContentAsset;
  events: BoardEvent[];
  status: BoardStatus;
  conflict: boolean;
  subscribers: Set<(event: BoardEvent) => void>;
  session: BoardSession;
}

const reviews = new Map<string, ReviewRecord>();

const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
const rulebooks = {
  us: loadRulebook(`${ASSETS}rulebook.us.json`),
  eu: loadRulebook(`${ASSETS}rulebook.eu.json`),
  latam: loadRulebook(`${ASSETS}rulebook.latam.json`),
};

const CreateReview = z.object({
  copy: z.string().min(1),
  claim: z.string().min(1),
  channel: z.string().min(1).default('instagram'),
  markets: z.array(z.string()).min(1),
  imagePrompt: z.string().optional(),
  substantiation: z.string().optional(),
});

const app = new Hono();
app.use('/api/*', cors());

app.post('/api/reviews', async (c) => {
  const body: unknown = await c.req.json().catch(() => ({}));
  const parsed = CreateReview.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const d = parsed.data;
  const id = randomUUID();
  const asset: ContentAsset = {
    id: `asset-${id.slice(0, 8)}`,
    channel: d.channel,
    markets: d.markets,
    copy: d.copy,
    claim: d.claim,
    ...(d.imagePrompt ? { imagePrompt: d.imagePrompt } : {}),
    ...(d.substantiation ? { substantiation: d.substantiation } : {}),
  };

  const record: ReviewRecord = {
    id,
    createdAt: Date.now(),
    asset,
    events: [],
    status: 'running',
    conflict: false,
    subscribers: new Set(),
    session: undefined as unknown as BoardSession,
  };
  const onEvent = (event: BoardEvent): void => {
    record.events.push(event);
    if (event.type === 'verdict' && event.conflict) record.conflict = true;
    if (event.type === 'status') record.status = event.status;
    for (const sub of record.subscribers) sub(event);
  };
  record.session = new BoardSession({ roomId: `review-${id}`, asset, brand, rulebooks, models: realBoardModels(), onEvent });
  reviews.set(id, record);

  void record.session.run().catch((err: unknown) => {
    onEvent({ type: 'log', seq: 0, fromName: 'system', messageType: 'error', text: `Review failed: ${(err as Error)?.message ?? String(err)}` });
    onEvent({ type: 'status', seq: 0, fromName: 'system', status: 'error' });
  });

  return c.json({ id });
});

app.get('/api/reviews', (c) => {
  const list = [...reviews.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((r) => ({ id: r.id, createdAt: r.createdAt, assetId: r.asset.id, copy: r.asset.copy, markets: r.asset.markets, status: r.status, conflict: r.conflict }));
  return c.json({ reviews: list });
});

app.get('/api/reviews/:id', (c) => {
  const record = reviews.get(c.req.param('id'));
  if (!record) return c.json({ error: 'not found' }, 404);
  return c.json({ id: record.id, status: record.status, asset: record.asset, events: record.events });
});

app.get('/api/reviews/:id/events', (c) => {
  const record = reviews.get(c.req.param('id'));
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
  void record.session.submitDecision(decision).catch(() => {});
  return c.json({ ok: true });
});

if (existsSync(WEB_DIST)) {
  app.use('/*', serveStatic({ root: './web/dist' }));
  app.get('*', serveStatic({ path: './web/dist/index.html' }));
} else {
  app.get('/', (c) =>
    c.text('Compliance console backend is running. Build the UI: cd web && pnpm install && pnpm build, or run cd web && pnpm dev. API is under /api.'),
  );
}

serve({ fetch: app.fetch, port: PORT });
console.log(`Compliance console backend listening on http://localhost:${PORT} (BOARD_MODE=local, MODEL_MODE=${process.env.MODEL_MODE ?? 'aiml'})`);
