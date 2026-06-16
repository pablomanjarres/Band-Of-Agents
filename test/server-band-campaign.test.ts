// Server routing for BOARD_MODE=band: the campaign-review path is driven by the
// portal (POST /api/reviews with a campaign), while single-asset reviews stay
// band.ai-only. No band.ai credentials are needed: importing the server does not
// connect agents (that only happens in main()), so the band board is not present
// here and a campaign review degrades gracefully to a status:error event, proving
// the campaign branch is REACHED and routed to the band path (not rejected like
// the single-asset branch). The end-to-end band negotiation itself is proven on
// the FakeBandTransport in band-campaign.test.ts.
//
// This test posts an INLINE campaign (never persisted), so it shares no on-disk
// state with the other server suites and is safe under parallel test runs.

import { describe, expect, it } from 'vitest';

// Force band mode BEFORE importing the server (BOARD_MODE is read once at import).
process.env.BOARD_MODE = 'band';

const { app } = await import('../src/server/index');

function inlineCampaign() {
  return {
    id: `band-srv-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Band Server Campaign',
    markets: ['US'],
    dossier: { approvedClaims: [], substantiation: '', approvedInfo: '', sources: [] },
    advertisements: [
      { id: 'ad-1', name: 'Ad One', materials: [{ id: 'm1', kind: 'post', channel: 'x', markets: ['US'], copy: 'c', claim: 'c' }] },
    ],
  };
}

describe('BOARD_MODE=band server routing', () => {
  it('rejects a single-asset review (those start from band.ai)', async () => {
    const res = await app.fetch(new Request('http://local/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ copy: 'hello', claim: 'c', channel: 'ig', markets: ['US'] }),
    }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error.toLowerCase()).toContain('band.ai');
  });

  it('ACCEPTS a campaign review (the portal drives the band path) and creates a record', async () => {
    const res = await app.fetch(new Request('http://local/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ campaign: inlineCampaign() }),
    }));
    // Accepted and routed to the campaign path (NOT the single-asset 400).
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; kind: string; materials: string[] };
    expect(body.kind).toBe('campaign');
    expect(body.materials).toEqual(['m1']);

    // The campaign-review record exists and streams via the shared endpoint. With no
    // band board connected in this import, the run degrades to a status:error event,
    // proving the campaign branch is reached and routed to the band path (a rejected
    // request would never have created a record).
    const review = await app.fetch(new Request(`http://local/api/campaign-reviews/${body.id}`));
    expect(review.status).toBe(200);
    const rec = (await review.json()) as { id: string };
    expect(rec.id).toBe(body.id);

    // Drain the async run; it should settle to error (no band board) rather than hang.
    let final = 'running';
    for (let i = 0; i < 80; i++) {
      const r = (await (await app.fetch(new Request(`http://local/api/campaign-reviews/${body.id}`))).json()) as { status: string };
      final = r.status;
      if (final === 'error' || final === 'complete' || final === 'awaiting-decision') break;
      await new Promise((res2) => setTimeout(res2, 10));
    }
    expect(final).toBe('error');
  });
});
