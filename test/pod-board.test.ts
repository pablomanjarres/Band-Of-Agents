// test/pod-board.test.ts
import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { StubModelClient, type ModelClient } from '../src/models/client';
import { connectPodBoardAgents, type PodBoardModels } from '../src/board/pod-board';
import { translateActivity, type BoardEvent } from '../src/board/events';
import { loadAsset, loadBrandDna, loadRulebook } from '../src/domain/load';

const ASSETS = new URL('../assets/', import.meta.url).pathname;

const findings = (severity: 'block' | 'warn' | 'info', claim: string) =>
  ({ text: '', json: { findings: [{ category: 'claim', severity, claim, rationale: 'r' }] } });

describe('pod board walking skeleton', () => {
  it('US passes, EU blocks and holds, remediation fails, escalates to the human, human spikes', async () => {
    const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
    const asset = loadAsset(`${ASSETS}sample-asset.json`);
    const claim = asset.claim;

    const pass: ModelClient = new StubModelClient(() => findings('info', claim));
    const empty: ModelClient = new StubModelClient(() => ({ text: '', json: { findings: [] } }));
    let euCall = 0;
    const euModel: ModelClient = new StubModelClient(() => (euCall++ % 2 === 0
      ? findings('block', claim)                                  // review: block
      : { text: '', json: { stance: 'hold', rationale: 'unlawful' } })); // rebuttal: hold
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
    const room = new FakeBandTransport('demo', { onActivity: (a) => { const e = translateActivity(a); if (e) events.push(e); } });
    room.addUser('lead', 'Compliance Lead', '@compliance-lead');
    await connectPodBoardAgents(room, { brand, rulebooks: { us: loadRulebook(`${ASSETS}rulebook.us.json`), eu: loadRulebook(`${ASSETS}rulebook.eu.json`), latam: loadRulebook(`${ASSETS}rulebook.latam.json`) }, models });

    room.post('lead', JSON.stringify(asset), [{ id: 'cond' }]);
    await room.drain();

    // The board reached escalation (deadlock survived one remediation).
    expect(events.some((e) => e.type === 'escalation')).toBe(true);

    // Human rules: reject.
    room.post('lead', 'Reject: cannot publish in EU without authorization', [{ id: 'adj' }]);
    await room.drain();

    const terminal = events.filter((e): e is Extract<BoardEvent, { type: 'terminal' }> => e.type === 'terminal');
    expect(terminal.some((e) => e.decision === 'spiked')).toBe(true);
    // The debate is visible.
    expect(events.some((e) => e.type === 'debate')).toBe(true);
    // At least one pod filed a conflict.
    expect(events.some((e) => e.type === 'pod-finding' && e.conflicts > 0)).toBe(true);
  });
});
