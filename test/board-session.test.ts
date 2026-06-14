import { describe, expect, it } from 'vitest';
import { BoardSession, type BoardModels } from '../src/board/session';
import { StubModelClient, type ModelClient } from '../src/models/client';
import { loadAsset, loadBrandDna, loadRulebook } from '../src/domain/load';
import type { BoardEvent } from '../src/board/events';

const ASSETS = new URL('../assets/', import.meta.url).pathname;

function findings(...items: unknown[]): { text: string; json: { findings: unknown[] } } {
  return { text: '', json: { findings: items } };
}

const EU_FIXABLE_BLOCK = {
  category: 'disclosure',
  severity: 'block',
  claim: 'whole asset',
  rationale: 'Missing Article 10(2) statements.',
  ruleId: 'eu-mandatory-disclosure',
  requiredDisclosure: 'Article 10(2) accompanying statements',
};

describe('BoardSession: the adapt -> remediation -> re-review loop closes', () => {
  it('EU adapts, gets remediated (with an image), is re-reviewed, and then publishes', async () => {
    const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
    const rulebooks = {
      us: loadRulebook(`${ASSETS}rulebook.us.json`),
      eu: loadRulebook(`${ASSETS}rulebook.eu.json`),
      latam: loadRulebook(`${ASSETS}rulebook.latam.json`),
    };
    const asset = loadAsset(`${ASSETS}sample-asset-adapt.json`);

    // EU blocks on the first pass (a fixable disclosure gap), then passes once the
    // remediated copy comes back round for re-review.
    let euPass = 0;
    const models: BoardModels = {
      us: new StubModelClient(() => findings()),
      eu: new StubModelClient(() => {
        euPass += 1;
        return euPass === 1 ? findings(EU_FIXABLE_BLOCK) : findings();
      }),
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

    // Two recruit rounds: the initial intake and the re-review.
    const recruited = events.filter((e): e is Extract<BoardEvent, { type: 'recruited' }> => e.type === 'recruited');
    expect(recruited.length).toBeGreaterThanOrEqual(2);

    // The remediation actually happened, with a regenerated image.
    const revised = events.find((e): e is Extract<BoardEvent, { type: 'revised' }> => e.type === 'revised');
    expect(revised?.region).toBe('EU');
    expect(revised?.imageUrl).toBe('https://cdn.aimlapi.com/revised-eu.png');

    // First verdict adapts EU; the final verdict (after re-review) publishes it.
    const verdicts = events.filter((e): e is Extract<BoardEvent, { type: 'verdict' }> => e.type === 'verdict');
    expect(verdicts.length).toBeGreaterThanOrEqual(2);
    expect(verdicts[0]?.verdicts.find((v) => v.region === 'EU')?.decision).toBe('adapt');
    expect(verdicts.at(-1)?.verdicts.find((v) => v.region === 'EU')?.decision).toBe('publish');

    const status = events.filter((e): e is Extract<BoardEvent, { type: 'status' }> => e.type === 'status');
    expect(status.at(-1)?.status).toBe('complete');
  });

  it('caps the loop: a region that stays broken after remediation escalates instead of looping', async () => {
    const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
    const rulebooks = {
      us: loadRulebook(`${ASSETS}rulebook.us.json`),
      eu: loadRulebook(`${ASSETS}rulebook.eu.json`),
      latam: loadRulebook(`${ASSETS}rulebook.latam.json`),
    };
    const asset = loadAsset(`${ASSETS}sample-asset-adapt.json`);

    // EU never clears its fixable block, so the loop must cap and escalate.
    const models: BoardModels = {
      us: new StubModelClient(() => findings()),
      eu: new StubModelClient(() => findings(EU_FIXABLE_BLOCK)),
      latam: new StubModelClient(() => findings()),
      brand: new StubModelClient(() => findings()),
      remediationCopy: new StubModelClient(() => ({ text: 'still as part of a varied, balanced diet and healthy lifestyle.' })),
      image: {
        model: 'stub-image',
        complete: async () => ({ text: '' }),
        generateImage: async () => ({ url: 'https://cdn.aimlapi.com/revised-eu.png' }),
      } satisfies ModelClient,
    };

    const events: BoardEvent[] = [];
    const session = new BoardSession({ roomId: 'cap-room', asset, brand, rulebooks, models, onEvent: (e) => events.push(e) });
    await session.run();

    // Exactly one remediation, then escalation (not an endless adapt loop).
    const revisedCount = events.filter((e) => e.type === 'revised').length;
    expect(revisedCount).toBe(1);
    expect(events.some((e) => e.type === 'escalation')).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'status', status: 'awaiting-decision' });
  });
});
