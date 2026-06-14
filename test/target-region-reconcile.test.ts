import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { makeCoordinator } from '../src/agents/coordinator';
import { makeRegionReviewer } from '../src/agents/region-reviewer';
import { makeBrandReviewer } from '../src/agents/brand-reviewer';
import { makeReconcile } from '../src/agents/reconcile';
import { StubModelClient } from '../src/models/client';
import { loadBrandDna, loadRulebook } from '../src/domain/load';
import type { ContentAsset } from '../src/domain/types';
import { probeBoard } from './helpers';

const ASSETS = new URL('../assets/', import.meta.url).pathname;
const REGION_HANDLES = { US: '@us-reviewer', EU: '@eu-reviewer', LATAM: '@latam-reviewer' };
const clear = () => ({ text: '', json: { findings: [] } });

// End-to-end pairing of P1.1: when the coordinator recruits a subset of regions
// for a single-market asset, Reconcile must wait only for that subset (plus the
// market-agnostic Brand), not block forever on the regions that never joined.
describe('Targeted recruitment reconciles end to end without waiting on un-recruited regions', () => {
  it('a US-only asset reaches a US + BRAND verdict and completes (Reconcile does not hang on EU/LATAM)', async () => {
    const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
    const usRules = loadRulebook(`${ASSETS}rulebook.us.json`);
    const euRules = loadRulebook(`${ASSETS}rulebook.eu.json`);

    const { board, find, events } = probeBoard();
    const room = new FakeBandTransport('room-e2e');
    room.addUser('lead', 'Lead', '@compliance-lead');
    await room.connectAgent({ agentId: 'coord', name: 'Coordinator', handle: '@coordinator', onMessage: makeCoordinator({ board, reconcileHandle: '@reconcile', regionHandles: REGION_HANDLES }) });
    await room.connectAgent({ agentId: 'us', name: 'US Reviewer', handle: '@us-reviewer', onMessage: makeRegionReviewer({ board, region: 'US', reviewerName: 'US Reviewer', rulebook: usRules, brand, model: new StubModelClient(clear), reportToHandle: '@reconcile' }) });
    await room.connectAgent({ agentId: 'eu', name: 'EU Reviewer', handle: '@eu-reviewer', onMessage: makeRegionReviewer({ board, region: 'EU', reviewerName: 'EU Reviewer', rulebook: euRules, brand, model: new StubModelClient(clear), reportToHandle: '@reconcile' }) });
    await room.connectAgent({ agentId: 'brand', name: 'Brand Reviewer', handle: '@brand-reviewer', onMessage: makeBrandReviewer({ board, brand, model: new StubModelClient(clear), reportToHandle: '@reconcile' }) });
    await room.connectAgent({ agentId: 'rec', name: 'Reconcile', handle: '@reconcile', onMessage: makeReconcile({ board, expectedRegions: ['US', 'EU', 'LATAM', 'BRAND'], marketRegions: ['US', 'EU', 'LATAM'], coordinatorHandle: '@coordinator', humanHandle: '@compliance-lead' }) });

    const usAsset: ContentAsset = { id: 'a-us', name: 'US-Only', channel: 'instagram', markets: ['US'], copy: 'c', claim: 'c' };
    room.post('lead', JSON.stringify(usAsset), [{ id: 'coord' }]);
    await room.drain();

    // Reconcile waited only for the recruited reviewers (US + Brand) and issued a verdict.
    const verdict = find('verdict');
    expect(verdict).toBeDefined();
    const regions = verdict!.verdicts.map((v) => v.region).sort();
    expect(regions).toEqual(['BRAND', 'US']);
    // It did not block on the un-recruited EU/LATAM lanes.
    expect(verdict!.verdicts.some((v) => v.region === 'EU')).toBe(false);
    expect(verdict!.verdicts.some((v) => v.region === 'LATAM')).toBe(false);
    // The review completed (no deadlock, no hang): a terminal status was emitted.
    expect(events.some((e) => e.type === 'status' && e.status === 'complete')).toBe(true);
  });
});
