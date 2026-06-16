// test/knowledge-source.test.ts
import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { makeKnowledgeSource } from '../src/agents/knowledge-source';
import { StubModelClient } from '../src/models/client';

const ASSET = JSON.stringify({ id: 'a1', channel: 'instagram', markets: ['US'], copy: 'c', claim: 'boost immunity' });

describe('knowledge source shell', () => {
  it('reviews the asset and reports findings to its pod lead', async () => {
    const room = new FakeBandTransport('r');
    const model = new StubModelClient(() => ({ text: '', json: { findings: [{ category: 'claim', severity: 'warn', claim: 'boost immunity', rationale: 'unsupported' }] } }));
    await room.connectAgent({ agentId: 'lead', name: 'Claims Lead', handle: '@claims-lead', onMessage: async () => {} });
    await room.connectAgent({
      agentId: 'ce', name: 'Claim & Evidence', handle: '@claim-evidence',
      onMessage: makeKnowledgeSource({ role: 'claim-evidence', reviewerName: 'Claim & Evidence', system: 'sys', jsonSchema: {}, model, reportToHandle: '@claims-lead' }),
    });
    room.post('lead', ASSET, [{ id: 'ce' }]);
    await room.drain();
    const reply = room.transcript.find((t) => t.fromId === 'ce' && t.kind === 'message');
    expect(reply).toBeTruthy();
    const payload = JSON.parse(reply!.content);
    expect(payload.source).toBe('claim-evidence');
    expect(payload.findings[0].severity).toBe('warn');
    expect(reply!.mentions.some((m) => m.id === 'lead')).toBe(true);
  });
});
