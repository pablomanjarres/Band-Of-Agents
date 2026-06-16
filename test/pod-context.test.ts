import { describe, expect, it } from 'vitest';
import { StubModelClient, type ModelClient } from '../src/models/client';
import { PodBoardSession } from '../src/board/pod-session';
import { type PodBoardModels } from '../src/board/pod-board';
import { loadAsset, loadBrandDna, loadRulebook } from '../src/domain/load';
import type { Rulebook } from '../src/domain/types';

const ASSETS = new URL('../assets/', import.meta.url).pathname;

describe('pod board context (precedent + live rulebook)', () => {
  it('threads recent precedent and the live rulebook into the region reviewers', async () => {
    const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
    const asset = loadAsset(`${ASSETS}sample-asset.json`);
    const baseEu = loadRulebook(`${ASSETS}rulebook.eu.json`);
    // A live override of the EU rulebook carrying a distinctive marker string.
    const liveEu: Rulebook = {
      ...baseEu,
      rules: baseEu.rules.map((r, i) => (i === 0 ? { ...r, check: `MARKER_RULE_TEXT ${r.check}` } : r)),
    };

    const seenEuSystems: string[] = [];
    const eu: ModelClient = new StubModelClient((req) => {
      seenEuSystems.push(req.system ?? '');
      return { text: '', json: { findings: [] } };
    });
    const empty: ModelClient = new StubModelClient(() => ({ text: '', json: { findings: [] } }));
    const image: ModelClient = { model: 'stub-image', complete: async () => ({ text: '' }), generateImage: async () => ({ url: 'http://img' }) };
    const models: PodBoardModels = {
      scout: empty, claim: empty, precedent: empty, disclosure: empty,
      us: empty, eu, latam: empty,
      brand: empty, channel: empty, visual: empty,
      mediator: empty, remediationCopy: empty, image,
    };

    const session = new PodBoardSession({
      roomId: 'ctx',
      asset,
      brand,
      rulebooks: { us: loadRulebook(`${ASSETS}rulebook.us.json`), eu: baseEu, latam: loadRulebook(`${ASSETS}rulebook.latam.json`) },
      models,
      onEvent: () => {},
      getPrecedents: () => ['EU: published with the Article 10(2) disclosure (human ruling)'],
      getRulebook: (region) => (region === 'EU' ? liveEu : undefined),
    });
    await session.run();

    const euSystem = seenEuSystems.join('\n');
    // Precedent loop is fed (was written but never read on the pod side).
    expect(euSystem).toContain('published with the Article 10(2) disclosure');
    // Live rulebook override reaches the reviewer instead of the static one.
    expect(euSystem).toContain('MARKER_RULE_TEXT');
  });
});
