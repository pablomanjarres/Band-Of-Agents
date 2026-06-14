import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { makeCoordinator } from '../src/agents/coordinator';
import { makeReviewer } from '../src/agents/reviewer';
import { probeBoard } from './helpers';

describe('Rung 2: coordinator hands off to a reviewer through the room', () => {
  it('coordinator recruits the reviewer; reviewer reviews and replies', async () => {
    const { board } = probeBoard();
    const room = new FakeBandTransport('room-r2');
    room.addUser('lead', 'Marketing Lead', '@lead');

    await room.connectAgent({
      agentId: 'coord',
      name: 'Coordinator',
      handle: '@coordinator',
      onMessage: makeCoordinator({ board }),
    });
    await room.connectAgent({
      agentId: 'us',
      name: 'US Reviewer',
      handle: '@us-reviewer',
      onMessage: makeReviewer({ review: async (asset) => `US reviewed: ${asset.slice(0, 24)}` }),
    });

    room.post('lead', 'Clinically proven to boost your immune system', [{ id: 'coord' }]);
    await room.drain();

    // Coordinator handed off to the reviewer.
    const handoff = room.transcript.find((t) => t.fromId === 'coord' && t.kind === 'message');
    expect(handoff?.mentions.map((m) => m.id)).toContain('us');

    // Reviewer replied, mentioning the coordinator back.
    const reply = room.transcript.find((t) => t.fromId === 'us' && t.kind === 'message');
    expect(reply?.content).toContain('US reviewed:');
    expect(reply?.mentions.map((m) => m.id)).toContain('coord');

    // No infinite loop: the coordinator does not re-handle the reviewer's reply.
    const coordMessages = room.transcript.filter((t) => t.fromId === 'coord' && t.kind === 'message');
    expect(coordMessages).toHaveLength(1);
  });
});
