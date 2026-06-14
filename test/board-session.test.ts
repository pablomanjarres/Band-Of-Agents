import { describe, expect, it } from 'vitest';
import { BoardSession, type BoardModels } from '../src/board/session';
import { StubModelClient, type ModelClient } from '../src/models/client';
import { loadAsset, loadBrandDna, loadRulebook } from '../src/domain/load';
import type { BoardEvent } from '../src/board/events';

const ASSETS = new URL('../assets/', import.meta.url).pathname;

function findings(...items: unknown[]): { text: string; json: { findings: unknown[] } } {
  return { text: '', json: { findings: items } };
}

describe('BoardSession streams typed board events for the console', () => {
  it('emits intake, four region reviews, a verdict, and an adapt -> remediation with an image', async () => {
    const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
    const rulebooks = {
      us: loadRulebook(`${ASSETS}rulebook.us.json`),
      eu: loadRulebook(`${ASSETS}rulebook.eu.json`),
      latam: loadRulebook(`${ASSETS}rulebook.latam.json`),
    };
    const asset = loadAsset(`${ASSETS}sample-asset-adapt.json`);

    // EU returns a fixable block (has a required disclosure) -> adapt -> remediation.
    const models: BoardModels = {
      us: new StubModelClient(() => findings()),
      eu: new StubModelClient(() =>
        findings({
          category: 'disclosure',
          severity: 'block',
          claim: 'whole asset',
          rationale: 'Missing Article 10(2) statements.',
          ruleId: 'eu-mandatory-disclosure',
          requiredDisclosure: 'Article 10(2) accompanying statements',
        }),
      ),
      latam: new StubModelClient(() => findings()),
      brand: new StubModelClient(() => findings()),
      remediationCopy: new StubModelClient(() => ({ text: 'Lumavida Immune+ supports everyday wellness as part of a varied, balanced diet and healthy lifestyle.' })),
      image: {
        model: 'stub-image',
        complete: async () => ({ text: '' }),
        generateImage: async () => ({ url: 'https://cdn.aimlapi.com/revised-eu.png' }),
      } satisfies ModelClient,
    };

    const events: BoardEvent[] = [];
    const session = new BoardSession({ roomId: 'test-room', asset, brand, rulebooks, models, onEvent: (e) => events.push(e) });
    await session.run();

    expect(events[0]?.type).toBe('intake');

    const regions = events
      .filter((e): e is Extract<BoardEvent, { type: 'review' }> => e.type === 'review')
      .map((e) => e.region)
      .sort();
    expect(regions).toEqual(['BRAND', 'EU', 'LATAM', 'US']);

    const verdict = events.find((e): e is Extract<BoardEvent, { type: 'verdict' }> => e.type === 'verdict');
    expect(verdict).toBeDefined();
    expect(verdict?.verdicts.find((v) => v.region === 'EU')?.decision).toBe('adapt');

    const revised = events.find((e): e is Extract<BoardEvent, { type: 'revised' }> => e.type === 'revised');
    expect(revised?.region).toBe('EU');
    expect(revised?.imageUrl).toBe('https://cdn.aimlapi.com/revised-eu.png');

    const status = events.filter((e): e is Extract<BoardEvent, { type: 'status' }> => e.type === 'status');
    expect(status.at(-1)?.status).toBe('complete');

    // seq is monotonic so the console can order/key reliably.
    const seqs = events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });
});
