import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { echoAgent } from '../src/agents/echo';

describe('Rung 1: one agent in a (fake) Band room', () => {
  it('replies through the room when @mentioned, mentioning the sender back', async () => {
    const room = new FakeBandTransport('room-1');
    room.addUser('human-1', 'Marketing Lead', '@lead');
    const conn = await room.connectAgent({
      agentId: 'coord-1',
      name: 'Coordinator',
      handle: '@coordinator',
      onMessage: echoAgent,
    });

    room.post('human-1', 'hello there', [{ id: 'coord-1' }]);
    await room.drain();

    const replies = room.transcript.filter((t) => t.fromId === 'coord-1' && t.kind === 'message');
    expect(replies).toHaveLength(1);
    expect(replies[0]?.content).toBe('Echo: hello there');
    expect(replies[0]?.mentions.map((m) => m.id)).toContain('human-1');

    await conn.stop();
  });

  it('stays silent when a message does not @mention it (directed, not a pipeline)', async () => {
    const room = new FakeBandTransport('room-2');
    room.addUser('human-1', 'Lead', '@lead');
    await room.connectAgent({
      agentId: 'coord-1',
      name: 'Coordinator',
      handle: '@coordinator',
      onMessage: echoAgent,
    });

    room.post('human-1', 'just chatting', []);
    await room.drain();

    expect(room.transcript.filter((t) => t.fromId === 'coord-1')).toHaveLength(0);
  });
});
