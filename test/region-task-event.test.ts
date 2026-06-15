import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { makeCoordinator } from '../src/agents/coordinator';
import { makeRegionReviewer } from '../src/agents/region-reviewer';
import { makeBrandReviewer } from '../src/agents/brand-reviewer';
import { makeReconcile } from '../src/agents/reconcile';
import { StubModelClient } from '../src/models/client';
import { loadAsset, loadBrandDna, loadRulebook } from '../src/domain/load';
import { probeBoard } from './helpers';

const ASSETS = new URL('../assets/', import.meta.url).pathname;

// Band accepts a fixed set of event types; 'task' is one of them. The per-region
// review lifecycle should show under that task channel, not only as thoughts.
describe("Per-region progress shows under Band's task channel", () => {
  it("the region reviewer emits a genuine 'task' lifecycle event per region", async () => {
    const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
    const usRules = loadRulebook(`${ASSETS}rulebook.us.json`);
    const euRules = loadRulebook(`${ASSETS}rulebook.eu.json`);
    const asset = loadAsset(`${ASSETS}sample-asset.json`);

    const usModel = new StubModelClient(() => ({ text: '', json: { findings: [] } }));
    const euModel = new StubModelClient(() => ({ text: '', json: { findings: [{ category: 'health_claim', severity: 'block', claim: 'boost immune system', rationale: 'unauthorised', ruleId: 'eu-health-preauth' }] } }));
    const brandModel = new StubModelClient(() => ({ text: '', json: { findings: [] } }));

    const { board } = probeBoard();
    const room = new FakeBandTransport('room-task');
    room.addUser('lead', 'Lead', '@compliance-lead');
    await room.connectAgent({ agentId: 'coord', name: 'Coordinator', handle: '@coordinator', onMessage: makeCoordinator({ board, reconcileHandle: '@reconcile' }) });
    await room.connectAgent({ agentId: 'us', name: 'US', handle: '@us-reviewer', onMessage: makeRegionReviewer({ board, region: 'US', reviewerName: 'US', rulebook: usRules, brand, model: usModel, reportToHandle: '@reconcile' }) });
    await room.connectAgent({ agentId: 'eu', name: 'EU', handle: '@eu-reviewer', onMessage: makeRegionReviewer({ board, region: 'EU', reviewerName: 'EU', rulebook: euRules, brand, model: euModel, reportToHandle: '@reconcile' }) });
    await room.connectAgent({ agentId: 'brand', name: 'Brand', handle: '@brand-reviewer', onMessage: makeBrandReviewer({ board, brand, model: brandModel, reportToHandle: '@reconcile' }) });
    await room.connectAgent({ agentId: 'rec', name: 'Reconcile', handle: '@reconcile', onMessage: makeReconcile({ board, expectedRegions: ['US', 'EU', 'BRAND'], coordinatorHandle: '@coordinator', humanHandle: '@compliance-lead' }) });

    room.post('lead', JSON.stringify(asset), [{ id: 'coord' }]);
    await room.drain();

    // The room shows at least one genuine 'task' event per region, not only thoughts.
    const taskEvents = room.transcript.filter((t) => t.kind === 'event' && t.messageType === 'task');
    expect(taskEvents.length).toBeGreaterThan(0);
    expect(taskEvents.some((t) => t.content.includes('US'))).toBe(true);
    expect(taskEvents.some((t) => t.content.includes('EU'))).toBe(true);
    // The brand lane reports its progress on the same task channel, for consistency.
    expect(taskEvents.some((t) => t.content.includes('Brand'))).toBe(true);
    // They are genuine 'task' events, not the generic 'thought' fallback.
    expect(taskEvents.every((t) => t.messageType === 'task')).toBe(true);
  });
});
