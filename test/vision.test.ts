import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { makeVisual } from '../src/agents/pod-members';
import { StubModelClient } from '../src/models/client';

const withImage = JSON.stringify({ id: 'a1', channel: 'instagram', markets: ['US'], copy: 'c', claim: 'boost', imageUrl: 'https://cdn.example/lemon.png' });
const noImage = JSON.stringify({ id: 'a2', channel: 'instagram', markets: ['US'], copy: 'c', claim: 'boost' });

async function runVisual(content: string): Promise<string[] | undefined> {
  let sawImages: string[] | undefined = ['unset'];
  const model = new StubModelClient((req) => { sawImages = req.images; return { text: '', json: { findings: [] } }; });
  const room = new FakeBandTransport('r');
  await room.connectAgent({ agentId: 'lead', name: 'Brand Lead', handle: '@brand-lead', onMessage: async () => {} });
  await room.connectAgent({ agentId: 'vis', name: 'Visual', handle: '@visual', onMessage: makeVisual(model) });
  room.post('lead', content, [{ id: 'vis' }]);
  await room.drain();
  return sawImages;
}

describe('visual pod member vision', () => {
  it('passes the campaign image to the model as vision input', async () => {
    expect(await runVisual(withImage)).toEqual(['https://cdn.example/lemon.png']);
  });

  it('omits images when the asset has none', async () => {
    expect(await runVisual(noImage)).toBeUndefined();
  });
});
