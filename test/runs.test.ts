// HTTP-level tests for the live run mirror (Stage B). The band.ai agents POST a run
// when a review starts and append one lifecycle event per beat; the dashboard reads
// /api/campaigns/:id/runs and subscribes to /api/runs/:id/events (SSE). These drive
// the real Hono app via app.fetch (no port), same as server-campaigns.test.ts.

import { describe, expect, it } from 'vitest';

// Importable, side-effect-free local path (KEY_FREE_LOCAL computed once at import).
process.env.BOARD_MODE = 'local';
delete process.env.AIML_API_KEY;
delete process.env.MODEL_MODE;

const { app } = await import('../src/server/index');

const BASE = 'http://local';

function req(method: string, path: string, body?: unknown): Request {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  return new Request(`${BASE}${path}`, init);
}

async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

interface RunEventShape {
  seq: number;
  at: number;
  stage: string;
  message: string;
  agent?: string;
  materialId?: string;
  artifact?: { kind: string; url: string; title?: string };
}

/** Drain a run SSE stream to its close, returning the parsed events. */
async function readRunSse(id: string): Promise<RunEventShape[]> {
  const res = await app.fetch(req('GET', `/api/runs/${id}/events`));
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events: RunEventShape[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data:')) events.push(JSON.parse(line.slice(5).trim()) as RunEventShape);
      }
    }
  }
  return events;
}

async function createRun(body: Record<string, unknown>): Promise<string> {
  const res = await app.fetch(req('POST', '/api/runs', body));
  expect(res.status).toBe(200);
  const out = await json<{ id: string }>(res);
  expect(out.id).toMatch(/^run-/);
  return out.id;
}

describe('POST /api/runs opens a run', () => {
  it('creates a running run with a summary', async () => {
    const res = await app.fetch(req('POST', '/api/runs', { campaignId: 'camp-x', advertisementId: 'ad-1', label: 'Hero Launch' }));
    expect(res.status).toBe(200);
    const body = await json<{ id: string; run: { status: string; label: string; campaignId: string; eventCount: number } }>(res);
    expect(body.id).toMatch(/^run-/);
    expect(body.run.status).toBe('running');
    expect(body.run.label).toBe('Hero Launch');
    expect(body.run.campaignId).toBe('camp-x');
    expect(body.run.eventCount).toBe(0);
  });

  it('400s when campaignId is missing', async () => {
    const res = await app.fetch(req('POST', '/api/runs', { label: 'no campaign' }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/runs/:id/events appends a timeline', () => {
  it('stamps seq + at, advances status, and 404s an unknown run', async () => {
    const id = await createRun({ campaignId: 'camp-evt' });

    const e1 = await app.fetch(req('POST', `/api/runs/${id}/events`, { stage: 'requested', message: 'Pablo asked the Conductor to review', agent: 'Conductor' }));
    expect(e1.status).toBe(200);
    const b1 = await json<{ event: RunEventShape; status: string }>(e1);
    expect(b1.event.seq).toBe(0);
    expect(typeof b1.event.at).toBe('number');
    expect(b1.status).toBe('running');

    const e2 = await app.fetch(req('POST', `/api/runs/${id}/events`, { stage: 'awaiting-decision', message: '2 blocking claims need your ruling', status: 'awaiting-decision' }));
    const b2 = await json<{ event: RunEventShape; status: string }>(e2);
    expect(b2.event.seq).toBe(1);
    expect(b2.status).toBe('awaiting-decision');

    // The full run carries both events in order.
    const got = await json<{ run: { status: string; events: RunEventShape[] } }>(await app.fetch(req('GET', `/api/runs/${id}`)));
    expect(got.run.status).toBe('awaiting-decision');
    expect(got.run.events.map((e) => e.stage)).toEqual(['requested', 'awaiting-decision']);

    // Unknown run -> 404 on append and on get.
    expect((await app.fetch(req('POST', '/api/runs/nope/events', { stage: 'log', message: 'x' }))).status).toBe(404);
    expect((await app.fetch(req('GET', '/api/runs/nope'))).status).toBe(404);
  });

  it('400s an event with an invalid stage', async () => {
    const id = await createRun({ campaignId: 'camp-bad' });
    const res = await app.fetch(req('POST', `/api/runs/${id}/events`, { stage: 'not-a-stage', message: 'x' }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/campaigns/:id/runs lists a campaign\'s runs', () => {
  it('returns this campaign\'s runs newest-first and excludes other campaigns', async () => {
    const cid = `camp-list-${Math.floor(Date.now()).toString(36)}`;
    const first = await createRun({ campaignId: cid, label: 'first' });
    const second = await createRun({ campaignId: cid, label: 'second' });
    await createRun({ campaignId: 'camp-other', label: 'other' });

    const body = await json<{ runs: Array<{ id: string; label: string; campaignId: string }> }>(await app.fetch(req('GET', `/api/campaigns/${cid}/runs`)));
    const ids = body.runs.map((r) => r.id);
    expect(ids).toContain(first);
    expect(ids).toContain(second);
    // Newest-first: the most recently created run comes before the earlier one.
    expect(ids.indexOf(second)).toBeLessThan(ids.indexOf(first));
    // Other campaigns are excluded.
    expect(body.runs.every((r) => r.campaignId === cid)).toBe(true);
  });
});

describe('GET /api/runs/:id/events (SSE) replays the timeline and closes on terminal status', () => {
  it('streams all events and self-closes when the run completes', async () => {
    const id = await createRun({ campaignId: 'camp-sse', label: 'sse' });
    await app.fetch(req('POST', `/api/runs/${id}/events`, { stage: 'requested', message: 'received', agent: 'Conductor' }));
    await app.fetch(req('POST', `/api/runs/${id}/events`, { stage: 'reviewing', message: 'pods reviewing', agent: 'Reg Lead' }));
    await app.fetch(req('POST', `/api/runs/${id}/events`, {
      stage: 'material',
      message: 'tailored EU version generated',
      agent: 'Remediation',
      artifact: { kind: 'image', url: 'https://example.test/a/new.png', title: 'EU version' },
    }));
    // A terminal event closes the SSE after replay.
    await app.fetch(req('POST', `/api/runs/${id}/events`, { stage: 'report', message: 'report posted', agent: 'Adjudicator', status: 'complete' }));

    const events = await readRunSse(id);
    expect(events.map((e) => e.stage)).toEqual(['requested', 'reviewing', 'material', 'report']);
    const artifact = events.find((e) => e.artifact)?.artifact;
    expect(artifact?.url).toBe('https://example.test/a/new.png');
    expect(events[events.length - 1]!.stage).toBe('report');
  });

  it('404s the SSE for an unknown run', async () => {
    expect((await app.fetch(req('GET', '/api/runs/nope/events'))).status).toBe(404);
  });
});
