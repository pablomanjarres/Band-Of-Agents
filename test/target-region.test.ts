import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { makeCoordinator } from '../src/agents/coordinator';
import { makeRegionReviewer } from '../src/agents/region-reviewer';
import { makeBrandReviewer } from '../src/agents/brand-reviewer';
import { makeReconcile } from '../src/agents/reconcile';
import { StubModelClient } from '../src/models/client';
import { loadBrandDna, loadRulebook } from '../src/domain/load';
import type { ContentAsset } from '../src/domain/types';
import type { Participant, RoomMessage, RoomTools } from '../src/band/types';
import { probeBoard } from './helpers';

const ASSETS = new URL('../assets/', import.meta.url).pathname;
// Region code -> the reviewer's configured handle (matches how the reviewers connect).
const REGION_HANDLES = { US: '@us-reviewer', EU: '@eu-reviewer', LATAM: '@latam-reviewer' };

const clear = () => ({ text: '', json: { findings: [] } });

describe('Target-region recruitment filters reviewers by asset.markets', () => {
  it('a US-only asset recruits US + Brand, never EU; EU files no review', async () => {
    const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
    const usRules = loadRulebook(`${ASSETS}rulebook.us.json`);
    const euRules = loadRulebook(`${ASSETS}rulebook.eu.json`);

    const { board } = probeBoard();
    const room = new FakeBandTransport('room-tr');
    room.addUser('lead', 'Lead', '@compliance-lead');
    await room.connectAgent({ agentId: 'coord', name: 'Coordinator', handle: '@coordinator', onMessage: makeCoordinator({ board, reconcileHandle: '@reconcile', regionHandles: REGION_HANDLES }) });
    await room.connectAgent({ agentId: 'us', name: 'US Reviewer', handle: '@us-reviewer', onMessage: makeRegionReviewer({ board, region: 'US', reviewerName: 'US Reviewer', rulebook: usRules, brand, model: new StubModelClient(clear), reportToHandle: '@reconcile' }) });
    await room.connectAgent({ agentId: 'eu', name: 'EU Reviewer', handle: '@eu-reviewer', onMessage: makeRegionReviewer({ board, region: 'EU', reviewerName: 'EU Reviewer', rulebook: euRules, brand, model: new StubModelClient(clear), reportToHandle: '@reconcile' }) });
    await room.connectAgent({ agentId: 'brand', name: 'Brand Reviewer', handle: '@brand-reviewer', onMessage: makeBrandReviewer({ board, brand, model: new StubModelClient(clear), reportToHandle: '@reconcile' }) });
    await room.connectAgent({ agentId: 'rec', name: 'Reconcile', handle: '@reconcile', onMessage: makeReconcile({ board, expectedRegions: ['US', 'BRAND'], coordinatorHandle: '@coordinator', humanHandle: '@compliance-lead' }) });

    const usAsset: ContentAsset = { id: 'a-us', name: 'US-Only', channel: 'instagram', markets: ['US'], copy: 'c', claim: 'c' };
    room.post('lead', JSON.stringify(usAsset), [{ id: 'coord' }]);
    await room.drain();

    // The coordinator's single handoff recruits only the targeted region plus Brand.
    const handoff = room.transcript.find((t) => t.fromId === 'coord' && t.kind === 'message');
    expect(handoff).toBeDefined();
    const mentionIds = handoff!.mentions.map((m) => m.id);
    expect(mentionIds).toContain('us');
    expect(mentionIds).toContain('brand');
    expect(mentionIds).not.toContain('eu');
    expect(handoff!.content).toContain('@us-reviewer');
    expect(handoff!.content).toContain('@brand-reviewer');
    expect(handoff!.content).not.toContain('@eu-reviewer');

    // Done-when: only the in-market region reviewer (plus non-region Brand) ran.
    expect(board.reviewFor('room-tr', 'US')).toBeDefined();
    expect(board.reviewFor('room-tr', 'BRAND')).toBeDefined();
    expect(board.reviewFor('room-tr', 'EU')).toBeUndefined();
    // EU was never @mentioned, so it never received a message.
    expect(room.transcript.some((t) => t.fromId === 'eu')).toBe(false);
  });

  it('pulls in an absent in-market region agent via addParticipant', async () => {
    const { board } = probeBoard();
    const added: { name: string; role?: string }[] = [];
    const participants: Participant[] = [
      { id: 'coord', name: 'Coordinator', handle: '@coordinator', type: 'agent' },
      { id: 'brand', name: 'Brand Reviewer', handle: '@brand-reviewer', type: 'agent' },
    ];
    const tools: RoomTools = {
      capabilities: { peers: false, contacts: false, memory: false },
      sendMessage: async () => {},
      sendEvent: async () => {},
      getParticipants: async () => participants,
      addParticipant: async (name, role) => {
        added.push(role === undefined ? { name } : { name, role });
      },
      lookupPeers: async () => participants,
    };
    const message: RoomMessage = {
      id: 'm', roomId: 'r', content: JSON.stringify({ id: 'a-latam', channel: 'post', markets: ['LATAM'], copy: 'c', claim: 'c' }),
      senderId: 'lead', senderType: 'user', senderName: 'Lead', messageType: 'chat', mentions: [], metadata: {}, createdAt: new Date(),
    };

    const handler = makeCoordinator({ board, reconcileHandle: '@reconcile', regionHandles: REGION_HANDLES });
    await handler(message, tools, { roomId: 'r', agentId: 'coord', agentName: 'Coordinator' });

    // The LATAM agent is not in the room, so it is recruited dynamically.
    expect(added.map((a) => a.name)).toContain('latam-reviewer');
  });
});
