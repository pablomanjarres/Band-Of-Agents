import { describe, expect, it } from 'vitest';
import { makeRegionReviewer } from '../src/agents/region-reviewer';
import type { ModelClient } from '../src/models/client';
import { loadBrandDna, loadRulebook } from '../src/domain/load';
import type { ContentAsset } from '../src/domain/types';
import type { Participant, RoomMessage, RoomTools } from '../src/band/types';
import { probeBoard } from './helpers';

const ASSETS = new URL('../assets/', import.meta.url).pathname;

function tools(): RoomTools {
  const participants: Participant[] = [
    { id: 'rec', name: 'Reconcile', handle: '@reconcile', type: 'agent' },
    { id: 'us', name: 'US Reviewer', handle: '@us', type: 'agent' },
  ];
  return {
    capabilities: { peers: false, contacts: false, memory: false },
    sendMessage: async () => {},
    sendEvent: async () => {},
    getParticipants: async () => participants,
    addParticipant: async () => {},
    lookupPeers: async () => participants,
  };
}

// The reviewer is triggered by an agent (the coordinator's recruit); the
// campaign it reviews is read from the board, not from this message body.
function recruitMsg(): RoomMessage {
  return { id: 'm', roomId: 'r', content: 'Please review this campaign and report to @Reconcile.', senderId: 'coord', senderType: 'agent', senderName: 'Coordinator', messageType: 'chat', mentions: [], metadata: {}, createdAt: new Date() };
}

const ASSET: ContentAsset = { id: 'a1', channel: 'post', markets: ['US'], copy: 'c', claim: 'c' };

describe('precedent -> shared context (closes the logs-precedent loop)', () => {
  it('feeds recent human-decision precedents into the region reviewer prompt', async () => {
    const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
    const usRules = loadRulebook(`${ASSETS}rulebook.us.json`);
    const { board } = probeBoard();
    board.startReview('r', ASSET);
    let captured = '';
    const model: ModelClient = {
      model: 'capture',
      complete: async (req) => {
        captured = req.system ?? '';
        return { text: '', json: { findings: [] } };
      },
    };
    const handler = makeRegionReviewer({
      board,
      region: 'US',
      reviewerName: 'US Reviewer',
      rulebook: usRules,
      brand,
      model,
      reportToHandle: '@reconcile',
      precedents: () => ['EU: Reject - require EFSA-authorised wording', 'US: Approve with typical-results disclosure'],
    });
    await handler(recruitMsg(), tools(), { roomId: 'r', agentId: 'us', agentName: 'US Reviewer' });

    expect(captured).toContain('Precedent');
    expect(captured).toContain('EFSA-authorised wording');
  });

  it('omits the precedent block when there are none', async () => {
    const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
    const usRules = loadRulebook(`${ASSETS}rulebook.us.json`);
    const { board } = probeBoard();
    board.startReview('r', ASSET);
    let captured = '';
    const model: ModelClient = {
      model: 'capture',
      complete: async (req) => {
        captured = req.system ?? '';
        return { text: '', json: { findings: [] } };
      },
    };
    const handler = makeRegionReviewer({ board, region: 'US', reviewerName: 'US Reviewer', rulebook: usRules, brand, model, reportToHandle: '@reconcile', precedents: () => [] });
    await handler(recruitMsg(), tools(), { roomId: 'r', agentId: 'us', agentName: 'US Reviewer' });
    expect(captured).not.toContain('Precedent');
  });
});
