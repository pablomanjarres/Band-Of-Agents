import { describe, expect, it } from 'vitest';
import { StubModelClient, type ModelClient } from '../src/models/client';
import { PodBoardSession } from '../src/board/pod-session';
import { type PodBoardModels } from '../src/board/pod-board';
import type { BoardEvent } from '../src/board/events';
import { loadAsset, loadBrandDna, loadRulebook } from '../src/domain/load';

const ASSETS = new URL('../assets/', import.meta.url).pathname;
const findings = (severity: 'block' | 'warn' | 'info', claim: string) =>
  ({ text: '', json: { findings: [{ category: 'claim', severity, claim, rationale: 'r' }] } });

describe('pod board session', () => {
  it('streams pod/board/spine events and reaches a terminal after the human ruling', async () => {
    const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
    const asset = loadAsset(`${ASSETS}sample-asset.json`);
    const claim = asset.claim;

    const pass: ModelClient = new StubModelClient(() => findings('info', claim));
    const empty: ModelClient = new StubModelClient(() => ({ text: '', json: { findings: [] } }));
    let euCall = 0;
    const euModel: ModelClient = new StubModelClient(() => (euCall++ % 2 === 0
      ? findings('block', claim)
      : { text: '', json: { stance: 'hold', rationale: 'unlawful' } }));
    const mediator: ModelClient = new StubModelClient(() => ({ text: '', json: { resolved: false, note: 'no movement', requiredDisclosure: null } }));
    const revised: ModelClient = new StubModelClient(() => ({ text: JSON.stringify({ ...asset, copy: 'softened' }) }));
    const image: ModelClient = { model: 'stub-image', complete: async () => ({ text: '' }), generateImage: async () => ({ url: 'http://img' }) };

    const models: PodBoardModels = {
      scout: empty, claim: empty, precedent: empty, disclosure: empty,
      us: pass, eu: euModel, latam: pass,
      brand: empty, channel: empty, visual: empty,
      mediator, remediationCopy: revised, image,
    };

    const events: BoardEvent[] = [];
    const session = new PodBoardSession({
      roomId: 'demo',
      asset,
      brand,
      rulebooks: {
        us: loadRulebook(`${ASSETS}rulebook.us.json`),
        eu: loadRulebook(`${ASSETS}rulebook.eu.json`),
        latam: loadRulebook(`${ASSETS}rulebook.latam.json`),
      },
      models,
      onEvent: (e) => events.push(e),
    });

    await session.run();
    // The pods debated, filed a conflict, and the spine escalated to the human.
    expect(events.some((e) => e.type === 'debate')).toBe(true);
    expect(events.some((e) => e.type === 'pod-finding' && e.conflicts > 0)).toBe(true);
    expect(events.some((e) => e.type === 'escalation')).toBe(true);

    await session.submitDecision('Reject: cannot publish in EU without authorization.');
    const terminal = events.find((e) => e.type === 'terminal') as Extract<BoardEvent, { type: 'terminal' }> | undefined;
    expect(terminal?.decision).toBe('spiked');

    // Events carry a monotonic seq across run() and submitDecision().
    expect(events.every((e, i) => i === 0 || e.seq >= events[i - 1]!.seq)).toBe(true);
  });
});
