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

describe('Full board (US + EU + Brand + Reconcile) issues per-region verdicts', () => {
  it('US=publish, EU=escalate, BRAND=publish, conflict flagged', async () => {
    const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
    const usRules = loadRulebook(`${ASSETS}rulebook.us.json`);
    const euRules = loadRulebook(`${ASSETS}rulebook.eu.json`);
    const asset = loadAsset(`${ASSETS}sample-asset.json`);

    const usModel = new StubModelClient(() => ({ text: '', json: { findings: [{ category: 'endorsement', severity: 'warn', claim: 't', rationale: 'r', ruleId: 'us-testimonial' }] } }));
    const euModel = new StubModelClient(() => ({ text: '', json: { findings: [{ category: 'health_claim', severity: 'block', claim: 'boost immune system', rationale: 'unauthorised', ruleId: 'eu-health-preauth' }] } }));
    const brandModel = new StubModelClient(() => ({ text: '', json: { findings: [] } }));

    const { board, find, events } = probeBoard();
    const room = new FakeBandTransport('room-fb');
    room.addUser('lead', 'Lead', '@compliance-lead');
    await room.connectAgent({ agentId: 'coord', name: 'Coordinator', handle: '@coordinator', onMessage: makeCoordinator({ board, reconcileHandle: '@reconcile' }) });
    await room.connectAgent({ agentId: 'us', name: 'US', handle: '@us-reviewer', onMessage: makeRegionReviewer({ board, region: 'US', reviewerName: 'US', rulebook: usRules, brand, model: usModel, reportToHandle: '@reconcile' }) });
    await room.connectAgent({ agentId: 'eu', name: 'EU', handle: '@eu-reviewer', onMessage: makeRegionReviewer({ board, region: 'EU', reviewerName: 'EU', rulebook: euRules, brand, model: euModel, reportToHandle: '@reconcile' }) });
    await room.connectAgent({ agentId: 'brand', name: 'Brand', handle: '@brand-reviewer', onMessage: makeBrandReviewer({ board, brand, model: brandModel, reportToHandle: '@reconcile' }) });
    await room.connectAgent({ agentId: 'rec', name: 'Reconcile', handle: '@reconcile', onMessage: makeReconcile({ board, expectedRegions: ['US', 'EU', 'BRAND'], coordinatorHandle: '@coordinator', humanHandle: '@compliance-lead' }) });

    room.post('lead', JSON.stringify(asset), [{ id: 'coord' }]);
    await room.drain();

    const verdict = find('verdict');
    expect(verdict).toBeDefined();
    const decision = (r: string) => verdict!.verdicts.find((v) => v.region === r)?.decision;
    expect(decision('US')).toBe('publish');
    expect(decision('EU')).toBe('escalate');
    expect(decision('BRAND')).toBe('publish');
    expect(verdict!.conflict).toBe(true);

    // EU deadlock escalated to the human: the board is now awaiting a decision.
    expect(events.some((e) => e.type === 'status' && e.status === 'awaiting-decision')).toBe(true);
  });
});
