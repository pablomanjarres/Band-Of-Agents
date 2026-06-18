// Pure helpers of the chat relay (src/server/relay.ts). The IO (connecting to
// band.ai, creating rooms, posting) needs a live SDK and is covered by the manual
// end-to-end test; here we pin the two pure pieces: the opening review prompt and
// the SSE dedup.

import { describe, expect, it } from 'vitest';
import { buildReviewPrompt, selectNewMessages, type RelayMessage } from '../src/server/relay';

const msg = (id: string, ts: number): RelayMessage => ({
  id,
  senderId: 's',
  senderName: 'Conductor',
  senderType: 'agent',
  content: `m${id}`,
  ts,
});

describe('buildReviewPrompt', () => {
  it('names the campaign and @mentions the conductor', () => {
    const p = buildReviewPrompt('Immune+ Q3 Launch');
    expect(p).toContain('@conductor');
    expect(p).toContain('Immune+ Q3 Launch');
    expect(p.toLowerCase()).toContain('review');
  });

  it('names the advertisement when given', () => {
    const p = buildReviewPrompt('Immune+ Q3 Launch', 'Hero Launch');
    expect(p).toContain('Hero Launch');
    expect(p).toContain('Immune+ Q3 Launch');
  });
});

describe('selectNewMessages', () => {
  it('returns only unseen messages and marks them seen', () => {
    const seen = new Set<string>();
    const first = selectNewMessages(seen, [msg('a', 1), msg('b', 2)]);
    expect(first.map((m) => m.id)).toEqual(['a', 'b']);
    // A second poll that re-returns a + b and adds c yields only c.
    const second = selectNewMessages(seen, [msg('a', 1), msg('b', 2), msg('c', 3)]);
    expect(second.map((m) => m.id)).toEqual(['c']);
  });

  it('skips messages with no id', () => {
    const seen = new Set<string>();
    const out = selectNewMessages(seen, [{ ...msg('', 1) }, msg('x', 2)]);
    expect(out.map((m) => m.id)).toEqual(['x']);
  });
});
