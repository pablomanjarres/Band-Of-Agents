// Band-native shared context. The brand DNA and per-region rulebooks are the
// shared context every reviewer coordinates around. band.ai 0.1.6 exposes no
// workspace file store and its Memory tools are gated, so the non-gated path is
// to publish the shared context INTO the room as a tagged message and rehydrate
// it via the /context endpoint (getChatContext), instead of a local JSON store.
// This module is the transport-agnostic core: a codec, a latest-wins selector
// (both pure and unit-testable), and a small store built over a REST facade.

import type { BrandDna, Rulebook } from '../domain/types';

/** Discriminator stored in a message's metadata so a shared-context post is findable on rehydration. */
export const SHARED_CONTEXT_KIND = 'shared-context';

/** The shared context: brand DNA plus the per-region rulebooks, keyed by region code. */
export interface SharedContextPayload {
  version: number;
  brandDna: BrandDna;
  rulebooks: Record<string, Rulebook>;
}

/** A minimal view of a band.ai chat message (snake_case wire shape) for rehydration. */
export interface ChatMessageLike {
  content: string;
  message_type?: string;
  metadata?: Record<string, unknown> | null;
  inserted_at?: string;
}

/** The slice of the band.ai REST facade this store needs (mirrors agent.runtime.link.rest). */
export interface ContextRest {
  createChatMessage?: (
    chatId: string,
    message: { content: string; messageType?: string; metadata?: Record<string, unknown> },
  ) => Promise<unknown>;
  getChatContext?: (
    request: { chatId: string; page?: number; pageSize?: number },
  ) => Promise<{ data: ChatMessageLike[] }>;
}

/** Publish the shared context into a room and rehydrate it from the room via /context. */
export interface SharedContextStore {
  publish(roomId: string, payload: SharedContextPayload): Promise<void>;
  rehydrate(roomId: string): Promise<SharedContextPayload | undefined>;
}

export function encodeSharedContext(payload: SharedContextPayload): string {
  return JSON.stringify(payload);
}

/**
 * Pick the most recent valid shared-context blob from a page of room messages.
 * Latest wins so a later publish (e.g. after a human ruling folds into the brand
 * DNA) supersedes earlier ones. Non-context and malformed messages are ignored.
 */
export function pickLatestSharedContext(messages: ChatMessageLike[]): SharedContextPayload | undefined {
  const candidates = messages
    .filter((m) => (m.metadata as { kind?: unknown } | null | undefined)?.kind === SHARED_CONTEXT_KIND)
    .sort((a, b) => Date.parse(b.inserted_at ?? '') - Date.parse(a.inserted_at ?? ''));
  for (const m of candidates) {
    const parsed = decodeSharedContext(m.content);
    if (parsed) return parsed;
  }
  return undefined;
}

function decodeSharedContext(content: string): SharedContextPayload | undefined {
  try {
    const o = JSON.parse(content) as Partial<SharedContextPayload> | null;
    if (o && typeof o === 'object' && o.brandDna && o.rulebooks && typeof o.version === 'number') {
      return o as SharedContextPayload;
    }
  } catch {
    // not JSON, or not a shared-context blob; skip it
  }
  return undefined;
}

/**
 * Build a shared-context store over a band.ai REST facade. Pure with respect to
 * the SDK (it takes the facade), so it is testable against a fake REST object,
 * exactly like buildIntakeControl. publish posts a tagged text message;
 * rehydrate reads the room context and returns the latest shared-context blob.
 */
export function makeBandSharedContext(rest: ContextRest, pageSize = 100): SharedContextStore {
  return {
    publish: async (roomId, payload) => {
      await rest.createChatMessage!(roomId, {
        content: encodeSharedContext(payload),
        messageType: 'text',
        metadata: { kind: SHARED_CONTEXT_KIND, version: payload.version },
      });
    },
    rehydrate: async (roomId) => {
      const page = await rest.getChatContext!({ chatId: roomId, page: 1, pageSize });
      return pickLatestSharedContext(page.data ?? []);
    },
  };
}
