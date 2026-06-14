import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { makeCoordinator } from '../src/agents/coordinator';
import { makeVisionReviewer } from '../src/agents/vision-reviewer';
import { makeReconcile } from '../src/agents/reconcile';
import { StubModelClient } from '../src/models/client';
import type { CompleteRequest } from '../src/models/client';
import { loadAsset, loadBrandDna } from '../src/domain/load';
import { probeBoard } from './helpers';

const ASSETS = new URL('../assets/', import.meta.url).pathname;

// The third AIML modality: a reviewer that reads the campaign IMAGE (not just the
// copy) and flags image-level issues, reporting to Reconcile like any region.
describe('Vision reviewer flags an image-level issue and reports it to Reconcile', () => {
  it('files an IMAGE finding from the campaign image and reports to Reconcile', async () => {
    const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
    const asset = loadAsset(`${ASSETS}sample-asset.json`);

    // Capture what the vision model is asked, then return a canned image finding.
    let sawImages: string[] | undefined;
    const visionModel = new StubModelClient((req: CompleteRequest) => {
      sawImages = req.images;
      return {
        text: '',
        json: { findings: [{ category: 'visual_claim', severity: 'warn', claim: 'sunlit glow implies an efficacy halo', rationale: 'The imagery suggests a health benefit not substantiated for a supplement.' }] },
      };
    });

    const { board, find, events } = probeBoard();
    const room = new FakeBandTransport('room-vision');
    room.addUser('lead', 'Lead', '@compliance-lead');
    await room.connectAgent({ agentId: 'coord', name: 'Coordinator', handle: '@coordinator', onMessage: makeCoordinator({ board, reconcileHandle: '@reconcile' }) });
    await room.connectAgent({ agentId: 'vis', name: 'Vision Reviewer', handle: '@vision-reviewer', onMessage: makeVisionReviewer({ board, reviewerName: 'Vision Reviewer', brand, model: visionModel, reportToHandle: '@reconcile' }) });
    await room.connectAgent({ agentId: 'rec', name: 'Reconcile', handle: '@reconcile', onMessage: makeReconcile({ board, expectedRegions: ['IMAGE'], coordinatorHandle: '@coordinator', humanHandle: '@compliance-lead' }) });

    // sample-asset has an imagePrompt but no rendered URL; give it one for a clean assertion.
    const withImage = { ...asset, imageUrl: asset.imageUrl ?? 'https://cdn.aimlapi.com/lumavida.png' };
    room.post('lead', JSON.stringify(withImage), [{ id: 'coord' }]);
    await room.drain();

    // The vision lane filed an image-level finding on the board.
    const review = find('review');
    expect(review).toBeDefined();
    expect(review!.region).toBe('IMAGE');
    expect(review!.findings).toHaveLength(1);
    expect(review!.findings[0]!.category).toMatch(/imag|visual/i);

    // The model was actually fed the image as vision INPUT.
    expect(sawImages).toContain(withImage.imageUrl);

    // The board emitted a review event for the IMAGE lane.
    expect(events.some((e) => e.type === 'review' && e.region === 'IMAGE')).toBe(true);

    // It reported to Reconcile in plain English, mentioning @reconcile.
    const report = room.transcript.find((t) => t.fromId === 'vis' && t.kind === 'message');
    expect(report?.content).toMatch(/Visual review:/);
    expect(report?.mentions.map((m) => m.id)).toContain('rec');
  });
});
