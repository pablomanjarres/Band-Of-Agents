import { describe, expect, it } from 'vitest';
import { buildIntakeControl } from '../src/band/real';
import type { MentionRef } from '../src/band/types';

// A fake of the band.ai REST facade (agent.runtime.link.rest). It records the
// calls so we can assert the asset id is forwarded as the chat's task_id, with
// no live band.ai call. Mirrors the mockTools pattern in band-mode-handles.test.ts.
function fakeRest() {
  const calls = {
    createChat: [] as (string | undefined)[],
    participants: [] as { chatId: string; participantId: string; role: string }[],
    messages: [] as { chatId: string; content: string; mentions?: MentionRef[] }[],
  };
  const api = {
    createChat: async (taskId?: string) => {
      calls.createChat.push(taskId);
      return { id: 'room-xyz' };
    },
    addChatParticipant: async (chatId: string, p: { participantId: string; role: string }) => {
      calls.participants.push({ chatId, participantId: p.participantId, role: p.role });
    },
    createChatMessage: async (chatId: string, m: { content: string; messageType?: string; mentions?: MentionRef[] }) => {
      const entry: { chatId: string; content: string; mentions?: MentionRef[] } = { chatId, content: m.content };
      if (m.mentions) entry.mentions = m.mentions;
      calls.messages.push(entry);
    },
  };
  return { api, calls };
}

describe('Intake task binding: the room carries the asset id as its task id', () => {
  it('forwards the asset id to createChat and surfaces a task-bind note', async () => {
    const { api, calls } = fakeRest();
    const binds: { roomId: string; taskId: string }[] = [];
    const control = buildIntakeControl(api, (roomId, taskId) => binds.push({ roomId, taskId }));

    const roomId = await control.createRoom('lumavida-immune-q3');

    // The asset id is forwarded as the Band task id, binding the room to the case.
    expect(calls.createChat).toEqual(['lumavida-immune-q3']);
    expect(roomId).toBe('room-xyz');
    // Task state is surfaced in the trace: the room is bound to the asset id.
    expect(binds).toEqual([{ roomId: 'room-xyz', taskId: 'lumavida-immune-q3' }]);
  });

  it('stays backward compatible when no task id is passed', async () => {
    const { api, calls } = fakeRest();
    const binds: { roomId: string; taskId: string }[] = [];
    const control = buildIntakeControl(api, (roomId, taskId) => binds.push({ roomId, taskId }));

    await control.createRoom();

    expect(calls.createChat).toEqual([undefined]);
    expect(binds).toEqual([]);
  });
});
