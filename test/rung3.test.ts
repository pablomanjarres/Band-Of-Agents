import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { makeCoordinator } from '../src/agents/coordinator';
import { makeRegionReviewer } from '../src/agents/region-reviewer';
import { StubModelClient } from '../src/models/client';
import { loadAsset, loadBrandDna, loadRulebook } from '../src/domain/load';
import { ReviewResult } from '../src/domain/types';

const ASSETS = new URL('../assets/', import.meta.url).pathname;

describe('Rung 3: a region reviewer produces structured findings on the sample asset', () => {
  it('US reviewer reviews the handed-off asset and posts a ReviewResult', async () => {
    const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
    const usRules = loadRulebook(`${ASSETS}rulebook.us.json`);
    const asset = loadAsset(`${ASSETS}sample-asset.json`);

    // Deterministic model: a US reviewer that flags the testimonial (warn).
    const model = new StubModelClient(() => ({
      text: '',
      json: {
        findings: [
          {
            category: 'endorsement',
            severity: 'warn',
            claim: '9 out of 10 users felt healthier',
            rationale: 'Testimonial requires a clear typical-results disclosure.',
            ruleId: 'us-testimonial',
          },
        ],
      },
    }));

    const room = new FakeBandTransport('room-r3');
    room.addUser('lead', 'Marketing Lead', '@lead');
    await room.connectAgent({
      agentId: 'coord',
      name: 'Coordinator',
      handle: '@coordinator',
      onMessage: makeCoordinator(),
    });
    await room.connectAgent({
      agentId: 'us',
      name: 'US Reviewer',
      handle: '@us-reviewer',
      onMessage: makeRegionReviewer({ region: 'US', reviewerName: 'US Reviewer', rulebook: usRules, brand, model }),
    });

    room.post('lead', JSON.stringify(asset), [{ id: 'coord' }]);
    await room.drain();

    const usMsg = room.transcript.find((t) => t.fromId === 'us' && t.kind === 'message');
    expect(usMsg).toBeDefined();
    const review = ReviewResult.parse(JSON.parse(usMsg!.content));
    expect(review.region).toBe('US');
    expect(review.findings.length).toBeGreaterThan(0);
    expect(review.findings[0]?.ruleId).toBe('us-testimonial');
    // With no reconcile agent present yet, the reviewer reports back to the coordinator.
    expect(usMsg!.mentions.map((m) => m.id)).toContain('coord');
  });

  it('loads valid rulebooks (US has 6 rules, EU has 7)', () => {
    expect(loadRulebook(`${ASSETS}rulebook.us.json`).rules).toHaveLength(6);
    expect(loadRulebook(`${ASSETS}rulebook.eu.json`).rules).toHaveLength(7);
  });
});
