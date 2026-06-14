import type { AgentHandler } from '../band/types';

// Rung 1 agent: the simplest possible participant. When @mentioned, it replies
// in the room, echoing the message back and @mentioning the original sender.
// This proves the coordination plumbing (connect, receive a directed message,
// post a reply) before any real reasoning is added.
export const echoAgent: AgentHandler = async (message, tools) => {
  const mention: { id: string; handle?: string } = { id: message.senderId };
  if (message.senderName) mention.handle = message.senderName;
  await tools.sendMessage(`Echo: ${message.content}`, [mention]);
};
