import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { makeCoordinator } from '../src/agents/coordinator';
import { makeRegionReviewer } from '../src/agents/region-reviewer';
import { makeBrandReviewer } from '../src/agents/brand-reviewer';
import { makeReconcile } from '../src/agents/reconcile';
import { StubModelClient } from '../src/models/client';
import { loadAsset, loadBrandDna, loadRulebook } from '../src/domain/load';

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

    const room = new FakeBandTransport('room-fb');
    room.addUser('lead', 'Lead', '@compliance-lead');
    await room.connectAgent({ agentId: 'coord', name: 'Coordinator', handle: '@coordinator', onMessage: makeCoordinator() });
    await room.connectAgent({ agentId: 'us', name: 'US', handle: '@us-reviewer', onMessage: makeRegionReviewer({ region: 'US', reviewerName: 'US', rulebook: usRules, brand, model: usModel, reportToHandle: '@reconcile' }) });
    await room.connectAgent({ agentId: 'eu', name: 'EU', handle: '@eu-reviewer', onMessage: makeRegionReviewer({ region: 'EU', reviewerName: 'EU', rulebook: euRules, brand, model: euModel, reportToHandle: '@reconcile' }) });
    await room.connectAgent({ agentId: 'brand', name: 'Brand', handle: '@brand-reviewer', onMessage: makeBrandReviewer({ brand, model: brandModel, reportToHandle: '@reconcile' }) });
    await room.connectAgent({ agentId: 'rec', name: 'Reconcile', handle: '@reconcile', onMessage: makeReconcile({ expectedRegions: ['US', 'EU', 'BRAND'], coordinatorHandle: '@coordinator', humanHandle: '@compliance-lead' }) });

    room.post('lead', JSON.stringify(asset), [{ id: 'coord' }]);
    await room.drain();

    const verdictMsg = room.transcript.find((t) => t.fromId === 'rec' && t.kind === 'message' && t.content.includes('verdicts'));
    expect(verdictMsg).toBeDefined();
    const payload = JSON.parse(verdictMsg!.content) as { verdicts: { region: string; decision: string }[]; conflict: boolean };
    const decision = (r: string) => payload.verdicts.find((v) => v.region === r)?.decision;
    expect(decision('US')).toBe('publish');
    expect(decision('EU')).toBe('escalate');
    expect(decision('BRAND')).toBe('publish');
    expect(payload.conflict).toBe(true);

    // EU deadlock escalated to the human.
    const escalation = room.transcript.find((t) => t.fromId === 'rec' && t.kind === 'message' && t.mentions.some((m) => m.id === 'lead'));
    expect(escalation).toBeDefined();
  });
});
