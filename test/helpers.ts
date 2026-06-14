// Test helper: a SharedBoard wired to collect the structured events the agents
// emit, so tests can assert on board state (reviews, campaign) and on the typed
// events (verdict, revised, decision, status) instead of parsing chat. The room
// transcript still carries the plain-English coordination for brief assertions.

import { SharedBoard } from '../src/board/shared';
import type { BoardEvent } from '../src/board/events';

export interface BoardProbe {
  board: SharedBoard;
  events: BoardEvent[];
  find<T extends BoardEvent['type']>(type: T): Extract<BoardEvent, { type: T }> | undefined;
}

/** A SharedBoard plus a captured event log and a typed finder over it. */
export function probeBoard(): BoardProbe {
  const events: BoardEvent[] = [];
  const board = new SharedBoard((_roomId, event) => events.push(event));
  return {
    board,
    events,
    find<T extends BoardEvent['type']>(type: T) {
      return events.find((e): e is Extract<BoardEvent, { type: T }> => e.type === type);
    },
  };
}
