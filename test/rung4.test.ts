import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { makeCoordinator } from '../src/agents/coordinator';
import { makeRegionReviewer } from '../src/agents/region-reviewer';
import { makeReconcile } from '../src/agents/reconcile';
import { StubModelClient } from '../src/models/client';
import { loadAsset, loadBrandDna, loadRulebook } from '../src/domain/load';

const ASSETS = new URL('../assets/', import.meta.url).pathname;

describe('Rung 4: the board detects the US-pass / EU-fail conflict and issues per-region verdicts', () => {
  it('US publishes, EU escalates, reconcile flags the cross-region conflict', async () => {
    const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
    const usRules = loadRulebook(`${ASSETS}rulebook.us.json`);
    const euRules = loadRulebook(`${ASSETS}rulebook.eu.json`);
    const asset = loadAsset(`${ASSETS}sample-asset.json`);

    // US: only a testimonial warning -> publishable.
    const usModel = new StubModelClient(() => ({
      text: '',
      json: {
        findings: [
          {
            category: 'endorsement',
            severity: 'warn',
            claim: '9 out of 10 users felt healthier',
            rationale: 'Needs a typical-results disclosure.',
            ruleId: 'us-testimonial',
          },
        ],
      },
    }));
    // EU: a hard, unresolvable health pre-authorization block -> escalate.
    const euModel = new StubModelClient(() => ({
      text: '',
      json: {
        findings: [
          {
            category: 'health_claim',
            severity: 'block',
            claim: 'clinically proven to boost your immune system',
            rationale: 'Unauthorised health claim; not on the EU Register.',
            ruleId: 'eu-health-preauth',
          },
          {
            category: 'disclosure',
            severity: 'block',
            claim: 'whole asset',
            rationale: 'Missing Article 10(2) statements.',
            ruleId: 'eu-mandatory-disclosure',
            requiredDisclosure: 'Article 10(2) accompanying statements',
          },
        ],
      },
    }));

    const room = new FakeBandTransport('room-r4');
    room.addUser('lead', 'Marketing Lead', '@lead');
    await room.connectAgent({ agentId: 'coord', name: 'Coordinator', handle: '@coordinator', onMessage: makeCoordinator() });
    await room.connectAgent({
      agentId: 'us',
      name: 'US Reviewer',
      handle: '@us-reviewer',
      onMessage: makeRegionReviewer({ region: 'US', reviewerName: 'US Reviewer', rulebook: usRules, brand, model: usModel, reportToHandle: '@reconcile' }),
    });
    await room.connectAgent({
      agentId: 'eu',
      name: 'EU Reviewer',
      handle: '@eu-reviewer',
      onMessage: makeRegionReviewer({ region: 'EU', reviewerName: 'EU Reviewer', rulebook: euRules, brand, model: euModel, reportToHandle: '@reconcile' }),
    });
    await room.connectAgent({
      agentId: 'rec',
      name: 'Reconcile',
      handle: '@reconcile',
      onMessage: makeReconcile({ expectedRegions: ['US', 'EU'], coordinatorHandle: '@coordinator' }),
    });

    room.post('lead', JSON.stringify(asset), [{ id: 'coord' }]);
    await room.drain();

    const verdictMsg = room.transcript.find((t) => t.fromId === 'rec' && t.kind === 'message');
    expect(verdictMsg).toBeDefined();
    const payload = JSON.parse(verdictMsg!.content) as {
      verdicts: { region: string; decision: string }[];
      conflict: boolean;
    };
    const us = payload.verdicts.find((v) => v.region === 'US');
    const eu = payload.verdicts.find((v) => v.region === 'EU');
    expect(us?.decision).toBe('publish');
    expect(eu?.decision).toBe('escalate');
    expect(payload.conflict).toBe(true);
  });
});
