import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { makeCoordinator } from '../src/agents/coordinator';
import { makeRegionReviewer } from '../src/agents/region-reviewer';
import { makeReconcile, type Precedent } from '../src/agents/reconcile';
import { StubModelClient } from '../src/models/client';
import { loadAsset, loadBrandDna, loadRulebook } from '../src/domain/load';

const ASSETS = new URL('../assets/', import.meta.url).pathname;

describe('Rung 5 (MVP): deadlock escalates to the human and the decision is recorded as precedent', () => {
  it('reconcile escalates EU to the human; the human rules and it is logged', async () => {
    const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
    const usRules = loadRulebook(`${ASSETS}rulebook.us.json`);
    const euRules = loadRulebook(`${ASSETS}rulebook.eu.json`);
    const asset = loadAsset(`${ASSETS}sample-asset.json`);

    const usModel = new StubModelClient(() => ({ text: '', json: { findings: [] } }));
    const euModel = new StubModelClient(() => ({
      text: '',
      json: {
        findings: [
          {
            category: 'health_claim',
            severity: 'block',
            claim: 'boost your immune system',
            rationale: 'Unauthorised health claim.',
            ruleId: 'eu-health-preauth',
          },
        ],
      },
    }));

    const precedents: Precedent[] = [];
    const room = new FakeBandTransport('room-r5');
    room.addUser('lead', 'Compliance Lead', '@compliance-lead');
    await room.connectAgent({ agentId: 'coord', name: 'Coordinator', handle: '@coordinator', onMessage: makeCoordinator() });
    await room.connectAgent({
      agentId: 'us',
      name: 'US',
      handle: '@us-reviewer',
      onMessage: makeRegionReviewer({ region: 'US', reviewerName: 'US', rulebook: usRules, brand, model: usModel, reportToHandle: '@reconcile' }),
    });
    await room.connectAgent({
      agentId: 'eu',
      name: 'EU',
      handle: '@eu-reviewer',
      onMessage: makeRegionReviewer({ region: 'EU', reviewerName: 'EU', rulebook: euRules, brand, model: euModel, reportToHandle: '@reconcile' }),
    });
    await room.connectAgent({
      agentId: 'rec',
      name: 'Reconcile',
      handle: '@reconcile',
      onMessage: makeReconcile({
        expectedRegions: ['US', 'EU'],
        coordinatorHandle: '@coordinator',
        humanHandle: '@compliance-lead',
        logPrecedent: (p) => precedents.push(p),
      }),
    });

    room.post('lead', JSON.stringify(asset), [{ id: 'coord' }]);
    await room.drain();

    const escalation = room.transcript.find(
      (t) => t.fromId === 'rec' && t.kind === 'message' && t.mentions.some((m) => m.id === 'lead'),
    );
    expect(escalation).toBeDefined();
    // The escalation reads as a brief for the human: the region, the issue, and the options.
    expect(escalation!.content).toContain('EU');
    expect(escalation!.content.toLowerCase()).toContain('request changes');

    // Human rules on the escalation.
    room.post('lead', 'Reject: require an EU-compliant rewrite with authorised wording and Article 10(2) disclosures.', [{ id: 'rec' }]);
    await room.drain();

    expect(precedents).toHaveLength(1);
    expect(precedents[0]?.regions).toContain('EU');
    expect(precedents[0]?.decision).toContain('Reject');

    const decisionEvent = room.transcript.find(
      (t) => t.fromId === 'rec' && t.kind === 'event' && t.content.includes('Human decision recorded'),
    );
    expect(decisionEvent).toBeDefined();
  });
});
