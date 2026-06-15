// test/regulatory-pod.test.ts
import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { makePodLead } from '../src/agents/pod-lead';
import { makeRegionReviewer } from '../src/agents/pod-region-reviewer';
import { StubModelClient } from '../src/models/client';
import { loadAsset, loadBrandDna, loadRulebook } from '../src/domain/load';

const ASSETS = new URL('../assets/', import.meta.url).pathname;

describe('regulatory pod debate', () => {
  it('US passes, EU holds a block on rebuttal, pod files a conflict', async () => {
    const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
    const usRules = loadRulebook(`${ASSETS}rulebook.us.json`);
    const euRules = loadRulebook(`${ASSETS}rulebook.eu.json`);
    const latamRules = loadRulebook(`${ASSETS}rulebook.latam.json`);
    const asset = loadAsset(`${ASSETS}sample-asset.json`);
    const claim = asset.claim;

    const pass = new StubModelClient(() => ({ text: '', json: { findings: [{ category: 'claim', severity: 'info', claim, rationale: 'substantiated' }] } }));
    const block = new StubModelClient(() => ({ text: '', json: { findings: [{ category: 'claim', severity: 'block', claim, rationale: 'Article 10(2)' }] } }));
    const hold = new StubModelClient(() => ({ text: '', json: { stance: 'hold', rationale: 'still unlawful' } }));
    // EU model returns a block on review, and a hold on rebuttal. Use a counter.
    let euCall = 0;
    const euModel = new StubModelClient(() => (euCall++ === 0 ? { text: '', json: { findings: [{ category: 'claim', severity: 'block', claim, rationale: 'Article 10(2)' }] } } : { text: '', json: { stance: 'hold', rationale: 'still unlawful' } }));

    const filed: string[] = [];
    const room = new FakeBandTransport('r');
    await room.connectAgent({ agentId: 'adj', name: 'Adjudicator', handle: '@adjudicator', onMessage: async (m) => { filed.push(m.content); } });
    await room.connectAgent({ agentId: 'reglead', name: 'Reg Lead', handle: '@reg-lead', onMessage: makePodLead({ pod: 'regulatory', members: ['@us-reviewer', '@eu-reviewer', '@latam-reviewer'], memberKeys: ['US', 'EU', 'LATAM'], reportToHandle: '@adjudicator', debate: true }) });
    await room.connectAgent({ agentId: 'us', name: 'US Reviewer', handle: '@us-reviewer', onMessage: makeRegionReviewer({ region: 'US', reviewerName: 'US Reviewer', rulebook: usRules, brand, model: pass, reportToHandle: '@reg-lead' }) });
    await room.connectAgent({ agentId: 'eu', name: 'EU Reviewer', handle: '@eu-reviewer', onMessage: makeRegionReviewer({ region: 'EU', reviewerName: 'EU Reviewer', rulebook: euRules, brand, model: euModel, reportToHandle: '@reg-lead' }) });
    await room.connectAgent({ agentId: 'latam', name: 'LATAM Reviewer', handle: '@latam-reviewer', onMessage: makeRegionReviewer({ region: 'LATAM', reviewerName: 'LATAM Reviewer', rulebook: latamRules, brand, model: pass, reportToHandle: '@reg-lead' }) });

    room.post('cond', JSON.stringify(asset), [{ id: 'reglead' }]);
    await room.drain();

    expect(filed).toHaveLength(1);
    const pf = JSON.parse(filed[0]!);
    expect(pf.conflicts.length).toBeGreaterThan(0);
    expect(pf.conflicts[0].blockedBy).toContain('EU');
    // the debate happened: EU was challenged and held
    const debate = room.transcript.find((t) => t.kind === 'event' && (t.content ?? '').includes('rebuts'));
    expect(debate).toBeTruthy();
  });
});
