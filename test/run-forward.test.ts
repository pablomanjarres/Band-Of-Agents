import { describe, expect, it } from 'vitest';
import { makeRunForwarder } from '../src/run/run-forward';

interface Captured {
  url: string;
  method?: string;
  body: unknown;
}

// A fake fetch that captures requests and returns a canned run id for POST /api/runs.
function fakeFetch(opts: { failOpen?: boolean } = {}) {
  const calls: Captured[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body as string) : undefined });
    if (url.endsWith('/api/runs')) {
      if (opts.failOpen) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ id: 'run-test1' }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  return { fetchFn, calls };
}

describe('run forwarder', () => {
  it('opens a run and only emits events once a run is open', async () => {
    const { fetchFn, calls } = fakeFetch();
    const fwd = makeRunForwarder({ backend: 'http://b', fetchFn });

    // Before opening: emit is a no-op (no run).
    await fwd.emit({ stage: 'log', message: 'too early' });
    expect(calls.length).toBe(0);

    await fwd.openRun({ campaignId: 'camp-1', advertisementId: 'ad-1', label: 'Hero Launch', total: 2 });
    expect(fwd.runId).toBe('run-test1');
    expect(calls[0]!.url).toBe('http://b/api/runs');
    expect(calls[0]!.body).toMatchObject({ campaignId: 'camp-1', advertisementId: 'ad-1', label: 'Hero Launch' });

    await fwd.emit({ stage: 'requested', message: 'received', agent: 'Conductor' });
    expect(calls[1]!.url).toBe('http://b/api/runs/run-test1/events');
    expect(calls[1]!.body).toMatchObject({ stage: 'requested', message: 'received', agent: 'Conductor' });
  });

  it('a failed open leaves no run, so later events are dropped (best effort)', async () => {
    const { fetchFn, calls } = fakeFetch({ failOpen: true });
    const fwd = makeRunForwarder({ backend: 'http://b', fetchFn });
    await fwd.openRun({ campaignId: 'c', label: 'x', total: 1 });
    expect(fwd.runId).toBeUndefined();
    await fwd.emit({ stage: 'report', message: 'verdict' });
    // Only the failed open call was attempted; the event was dropped.
    expect(calls.filter((c) => c.url.includes('/events')).length).toBe(0);
  });

  it('completes the run only when every material has a final verdict', async () => {
    const { fetchFn, calls } = fakeFetch();
    const fwd = makeRunForwarder({ backend: 'http://b', fetchFn });
    await fwd.openRun({ campaignId: 'c', label: 'two materials', total: 2 });

    await fwd.onVerdict({ materialId: 'm1', decision: 'published', reportUrl: 'http://b/a/r1', summary: 'm1 ok' });
    const e1 = calls.find((c) => c.url.includes('/events'))!.body as { stage: string; status?: string; artifact?: { url: string } };
    expect(e1.stage).toBe('report');
    expect(e1.status).toBeUndefined(); // 1 of 2 -> still running
    expect(e1.artifact?.url).toBe('http://b/a/r1');

    await fwd.onVerdict({ materialId: 'm2', decision: 'spiked', summary: 'm2 blocked' });
    const events = calls.filter((c) => c.url.includes('/events')).map((c) => c.body as { status?: string });
    expect(events[events.length - 1]!.status).toBe('complete'); // 2 of 2 -> complete
  });

  it('an escalation parks the run in awaiting-decision; the later final verdict completes it', async () => {
    const { fetchFn, calls } = fakeFetch();
    const fwd = makeRunForwarder({ backend: 'http://b', fetchFn });
    await fwd.openRun({ campaignId: 'c', label: 'one material', total: 1 });

    await fwd.onVerdict({ materialId: 'm1', decision: 'escalated', summary: 'needs ruling' });
    const esc = calls.filter((c) => c.url.includes('/events')).pop()!.body as { stage: string; status?: string };
    expect(esc.stage).toBe('awaiting-decision');
    expect(esc.status).toBe('awaiting-decision');

    // Human rules -> final verdict lands; now all materials are done -> complete.
    await fwd.onVerdict({ materialId: 'm1', decision: 'published', summary: 'approved' });
    const done = calls.filter((c) => c.url.includes('/events')).pop()!.body as { status?: string };
    expect(done.status).toBe('complete');
  });

  it('onMaterial emits a material beat with an image artifact', async () => {
    const { fetchFn, calls } = fakeFetch();
    const fwd = makeRunForwarder({ backend: 'http://b', fetchFn });
    await fwd.openRun({ campaignId: 'c', label: 'x', total: 1 });
    await fwd.onMaterial('http://b/api/images/new.png', { title: 'EU version' });
    const beat = calls.filter((c) => c.url.includes('/events')).pop()!.body as { stage: string; artifact?: { kind: string; url: string; title?: string } };
    expect(beat.stage).toBe('material');
    expect(beat.artifact).toMatchObject({ kind: 'image', url: 'http://b/api/images/new.png', title: 'EU version' });
  });
});
