import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { makeCoordinator } from '../src/agents/coordinator';
import { makeRegionReviewer } from '../src/agents/region-reviewer';
import { makeReconcile } from '../src/agents/reconcile';
import { makeRemediation } from '../src/agents/remediation';
import { StubModelClient, type ModelClient } from '../src/models/client';
import { loadAsset, loadBrandDna, loadRulebook } from '../src/domain/load';
import { probeBoard } from './helpers';

const ASSETS = new URL('../assets/', import.meta.url).pathname;

describe('Remediation loop: an adapt verdict triggers a rewrite + regenerated image', () => {
  it('reconcile routes the adapt region to remediation, which posts a revised asset', async () => {
    const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
    const euRules = loadRulebook(`${ASSETS}rulebook.eu.json`);
    const asset = loadAsset(`${ASSETS}sample-asset.json`);

    // EU: a fixable block (has a required disclosure) -> 'adapt'.
    const euModel = new StubModelClient(() => ({
      text: '',
      json: {
        findings: [
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
    const copyModel = new StubModelClient(() => ({
      text: 'Northwind Immune+ supports your everyday wellness as part of a varied, balanced diet and healthy lifestyle.',
    }));
    const imageModel: ModelClient = {
      model: 'stub-image',
      complete: async () => ({ text: '' }),
      generateImage: async () => ({ url: 'https://cdn.aimlapi.com/revised-eu.png' }),
    };

    const { board, find } = probeBoard();
    const room = new FakeBandTransport('room-rem');
    room.addUser('lead', 'Lead', '@compliance-lead');
    await room.connectAgent({ agentId: 'coord', name: 'Coordinator', handle: '@coordinator', onMessage: makeCoordinator({ board, reconcileHandle: '@reconcile', remediationHandle: '@remediation' }) });
    await room.connectAgent({
      agentId: 'eu',
      name: 'EU',
      handle: '@eu-reviewer',
      onMessage: makeRegionReviewer({ board, region: 'EU', reviewerName: 'EU', rulebook: euRules, brand, model: euModel, reportToHandle: '@reconcile' }),
    });
    await room.connectAgent({
      agentId: 'rem',
      name: 'Remediation',
      handle: '@remediation',
      onMessage: makeRemediation({ board, brand, copyModel, imageModel, reportToHandle: '@coordinator' }),
    });
    await room.connectAgent({
      agentId: 'rec',
      name: 'Reconcile',
      handle: '@reconcile',
      onMessage: makeReconcile({ board, expectedRegions: ['EU'], coordinatorHandle: '@coordinator', remediationHandle: '@remediation' }),
    });

    room.post('lead', JSON.stringify(asset), [{ id: 'coord' }]);
    await room.drain();

    // The revised asset is published to the board (rewritten copy + regenerated image).
    const revised = find('revised');
    expect(revised).toBeDefined();
    expect(revised!.region).toBe('EU');
    expect(revised!.copy).toContain('balanced diet');
    expect(revised!.imageUrl).toBe('https://cdn.aimlapi.com/revised-eu.png');
    expect(revised!.markets).toEqual(['EU']);
  });
});
