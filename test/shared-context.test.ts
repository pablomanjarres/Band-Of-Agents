import { describe, expect, it } from 'vitest';
import {
  SHARED_CONTEXT_KIND,
  encodeSharedContext,
  pickLatestSharedContext,
  makeBandSharedContext,
  type ChatMessageLike,
  type SharedContextPayload,
} from '../src/band/shared-context';
import type { BrandDna, Rulebook } from '../src/domain/types';

const brandDna: BrandDna = { brand: 'Lumavida', voice: ['warm'], approvedVocabulary: ['supports'], forbiddenPhrases: ['cure'] };
const usRb: Rulebook = { region: 'US', label: 'US FTC', notLegalAdvice: true, rules: [] };
const payload = (version: number): SharedContextPayload => ({ version, brandDna, rulebooks: { US: usRb } });

function msg(content: string, metadata: Record<string, unknown> | null, inserted_at: string): ChatMessageLike {
  return { content, message_type: 'text', metadata, inserted_at };
}

describe('Band-native shared context (publish + rehydrate via /context, not the local store)', () => {
  it('pickLatestSharedContext returns the most recent valid shared-context blob', () => {
    const messages: ChatMessageLike[] = [
      msg('plain room chatter', null, '2026-06-14T10:00:00Z'),
      msg(encodeSharedContext(payload(1)), { kind: SHARED_CONTEXT_KIND }, '2026-06-14T10:01:00Z'),
      msg('a different event', { kind: 'verdict' }, '2026-06-14T10:02:00Z'),
      msg(encodeSharedContext(payload(2)), { kind: SHARED_CONTEXT_KIND }, '2026-06-14T10:03:00Z'),
    ];
    const ctx = pickLatestSharedContext(messages);
    expect(ctx?.version).toBe(2);
    expect(ctx?.brandDna.brand).toBe('Lumavida');
    expect(ctx?.rulebooks.US?.region).toBe('US');
  });

  it('ignores malformed blobs and returns undefined when there is no shared context', () => {
    expect(pickLatestSharedContext([])).toBeUndefined();
    expect(pickLatestSharedContext([msg('{bad json', { kind: SHARED_CONTEXT_KIND }, '2026-06-14T10:00:00Z')])).toBeUndefined();
    expect(pickLatestSharedContext([msg('just a normal message', null, '2026-06-14T10:00:00Z')])).toBeUndefined();
  });

  it('publishes via createChatMessage (tagged, not a gated memory) and rehydrates via getChatContext', async () => {
    const stored: ChatMessageLike[] = [];
    const rest = {
      createChatMessage: async (
        _chatId: string,
        m: { content: string; messageType?: string; metadata?: Record<string, unknown> },
      ) => {
        stored.push({ content: m.content, message_type: m.messageType, metadata: m.metadata ?? null, inserted_at: `2026-06-14T10:0${stored.length}:00Z` });
      },
      getChatContext: async (_req: { chatId: string }) => ({ data: stored }),
    };
    const store = makeBandSharedContext(rest);

    await store.publish('room-1', payload(1));
    await store.publish('room-1', payload(7));

    // It was published as a tagged text message in the room, not via the gated Memory tools.
    expect(stored).toHaveLength(2);
    expect(stored[1]!.metadata).toMatchObject({ kind: SHARED_CONTEXT_KIND });
    expect(stored[1]!.message_type).toBe('text');

    const rehydrated = await store.rehydrate('room-1');
    expect(rehydrated?.version).toBe(7);
    expect(rehydrated?.rulebooks.US?.label).toBe('US FTC');
  });
});
