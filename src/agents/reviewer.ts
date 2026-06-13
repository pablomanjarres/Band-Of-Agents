import type { AgentContext, AgentHandler, Mention, RoomMessage } from '../band/types';

export interface ReviewerOptions {
  /**
   * Produce the reply text for an incoming review request. Rung 2 uses a canned
   * stub; Rung 3 swaps in a ModelClient-backed review that emits structured findings.
   */
  review: (assetText: string, ctx: AgentContext) => Promise<string>;
  /** Who to @mention with the result. Defaults to the requester (the coordinator). */
  reportTo?: (message: RoomMessage) => Mention;
}

// A reviewer acts only when another agent (the coordinator) directs work to it,
// then posts its result back, @mentioning the requester (or a configured target
// such as the reconcile agent).
export function makeReviewer(opts: ReviewerOptions): AgentHandler {
  return async (message, tools, ctx) => {
    if (message.senderType !== 'agent') return;

    const reply = await opts.review(message.content, ctx);
    const mention: Mention = opts.reportTo
      ? opts.reportTo(message)
      : { id: message.senderId, ...(message.senderName ? { handle: message.senderName } : {}) };
    await tools.sendMessage(reply, [mention]);
  };
}
