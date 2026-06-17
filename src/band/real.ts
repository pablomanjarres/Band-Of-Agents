// Real band.ai transport: wraps @band-ai/sdk. Each connectAgent() creates a
// GenericAdapter-backed Agent, adapts Band's message/tools shape to our seam,
// and runs it (non-blocking) so several agents can run in one process. An
// optional onActivity hook surfaces every outbound message/event for the console
// to observe the real room. connectIntake() returns a control object that drives
// a room proactively (create, add participants, post) via the agent's REST
// facade, which is how the campaign portal injects a campaign into band.ai.
// Set BAND_DEBUG=1 to trace activity to stderr.

import { Agent, GenericAdapter, loadAgentConfigFromEnv } from '@band-ai/sdk';
import type {
  ActivityCallback,
  AgentConnection,
  BandTransport,
  ConnectOptions,
  IntakeControl,
  Mention,
  MentionInput,
  MentionRef,
  Participant,
  Peer,
  RoomMessage,
  RoomTools,
} from './types';
import { makeBandSharedContext, type ContextRest, type SharedContextStore } from './shared-context';

const DEBUG = process.env.BAND_DEBUG === '1';
function dbg(...args: unknown[]): void {
  if (DEBUG) console.error('[band]', ...args);
}

// Minimal structural views of the SDK boundary (documented shapes).
interface BandPlatformMessage {
  id: string;
  roomId: string;
  content: string;
  senderId: string;
  senderType: string;
  senderName: string | null;
  messageType: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}
interface BandToolsLike {
  capabilities?: { peers: boolean; contacts: boolean; memory: boolean };
  sendMessage(content: string, mentions?: unknown): Promise<unknown>;
  sendEvent(content: string, messageType: string, metadata?: Record<string, unknown>): Promise<unknown>;
  getParticipants(): Promise<Array<{ id: string; name: string; type: string; handle?: string | null; role?: string }>>;
  addParticipant(name: string, role?: string): Promise<unknown>;
  lookupPeers?(page?: number, pageSize?: number): Promise<unknown>;
}
interface BandAdapterArgs {
  message: BandPlatformMessage;
  tools: BandToolsLike;
  agentName?: string;
}

// A recent message as returned by link.rest.listMessages (snake_case), used by the
// catch-up poll to replay a message the live socket missed.
interface PlatformChatMsg {
  id: string;
  content?: string;
  sender_id: string;
  sender_type: string;
  sender_name?: string | null;
  message_type?: string;
  metadata?: { mentions?: Array<{ id?: string }> } & Record<string, unknown>;
  inserted_at: string;
}
// The slice of agent.runtime we reach for the catch-up: list rooms, list a room's
// recent messages, and re-inject one through the normal handler (with tools).
interface AgentRuntimeLike {
  link?: {
    subscribeAgentRooms?: () => Promise<void>;
    listAllChats?: () => Promise<Array<{ id?: unknown; updated_at?: unknown; room?: { id?: unknown } }>>;
    rest?: { listMessages?: (a: { chatId: string; page: number; pageSize: number }) => Promise<{ data?: PlatformChatMsg[] }> };
  };
  bootstrapRoomMessage?: (roomId: string, message: BandPlatformMessage) => Promise<void>;
}

// The REST facade reached via agent.runtime.link.rest (verified by intake-probe).
interface IntakeRest {
  createChat?: (taskId?: string) => Promise<{ id: string }>;
  addChatParticipant?: (chatId: string, p: { participantId: string; role: string }) => Promise<unknown>;
  createChatMessage?: (
    chatId: string,
    m: { content: string; messageType?: string; mentions?: MentionRef[] },
  ) => Promise<unknown>;
}

type EmitActivity = (kind: 'message' | 'event', content: string, messageType: string) => void;

/** A trace sink for the task binding: called with the new room id and the task (asset) id. */
export type TaskBindNote = (roomId: string, taskId: string) => void;

/**
 * Build the intake control object from a band.ai REST facade. Extracted as a
 * pure helper (no SDK or Agent dependency) so the task-id forwarding is testable
 * without a live band.ai call. createRoom forwards the optional task id to
 * createChat, so the room is bound to the asset as its Band task, and surfaces
 * the binding through onTaskBind. Methods are invoked on the facade object so
 * its `this` stays bound.
 */
export function buildIntakeControl(
  api: IntakeRest,
  onTaskBind?: TaskBindNote,
  stop: () => Promise<void> = async () => {},
): IntakeControl {
  return {
    createRoom: async (taskId) => {
      const roomId = (await api.createChat!(taskId)).id;
      if (taskId) onTaskBind?.(roomId, taskId);
      return roomId;
    },
    addParticipant: async (roomId, agentId, role = 'member') => {
      await api.addChatParticipant!(roomId, { participantId: agentId, role });
    },
    postMessage: async (roomId, content, mentions) => {
      await api.createChatMessage!(roomId, { content, mentions });
    },
    stop,
  };
}

export class RealBandTransport implements BandTransport {
  private readonly onActivity?: ActivityCallback;
  private seq = 0;

  constructor(opts: { onActivity?: ActivityCallback } = {}) {
    this.onActivity = opts.onActivity;
  }

  private emit(kind: 'message' | 'event', roomId: string, fromId: string, fromName: string, content: string, messageType: string): void {
    this.onActivity?.({ kind, roomId, fromId, fromName, content, messageType, mentions: [], seq: this.seq++ });
  }

  async connectAgent(opts: ConnectOptions): Promise<AgentConnection> {
    const config = opts.envPrefix
      ? loadAgentConfigFromEnv({ prefix: opts.envPrefix })
      : opts.apiKey
        ? { agentId: opts.agentId, apiKey: opts.apiKey }
        : loadAgentConfigFromEnv();

    // Dedup across live delivery and the catch-up poll: whichever sees a message id
    // first handles it; the other skips. Prevents double-processing.
    const seen = new Set<string>();
    const markSeen = (id: string): void => {
      seen.add(id);
      if (seen.size > 2000) { let i = 0; for (const k of seen) { seen.delete(k); if (++i >= 1000) break; } }
    };

    const adapter = new GenericAdapter(async (raw: unknown): Promise<void> => {
      const args = raw as BandAdapterArgs;
      const message = toRoomMessage(args.message);
      if (message.id && seen.has(message.id)) return;
      if (message.id) markSeen(message.id);
      dbg(`${opts.name} <- ${message.senderName ?? message.senderType}: ${message.content.slice(0, 100)}`);
      const emit: EmitActivity = (kind, content, messageType) =>
        this.emit(kind, args.message.roomId, config.agentId, opts.name, content, messageType);
      const tools = wrapTools(args.tools, opts.name, emit);
      try {
        await opts.onMessage(message, tools, {
          roomId: args.message.roomId,
          agentId: config.agentId,
          agentName: args.agentName ?? opts.name,
        });
      } catch (err) {
        dbg(`${opts.name} handler error: ${(err as Error)?.message ?? String(err)}`);
      }
    });

    const agent = Agent.create({ adapter, config });
    dbg(`${opts.name} connecting (${config.agentId})`);
    void agent.run({ signals: false });

    // The SDK does not reliably auto-join rooms a human creates in app.band.ai
    // after the agent connected, so re-subscribe to all of the agent's rooms on a
    // short interval. This lets you add the agents to a room and post, and they
    // pick it up within a few seconds without restarting the server.
    const subscribeRooms = (): void => {
      const link = (agent as { runtime?: { link?: { subscribeAgentRooms?: () => Promise<void> } } })?.runtime?.link;
      try {
        void link?.subscribeAgentRooms?.();
      } catch (e) {
        dbg(`${opts.name} subscribe error: ${(e as Error)?.message ?? String(e)}`);
      }
    };

    // Catch-up: the SDK does not replay a message posted in the window before the
    // agent subscribed to a (often brand-new) room. So each cycle, fetch recent
    // messages per room and re-inject any unseen @mention to us through the normal
    // handler (bootstrapRoomMessage routes through the adapter with working tools).
    // This makes the FIRST post in a new room reliable, no re-post needed.
    // Only re-inject the LATEST message of a room, and only if it is a still-unanswered
    // @mention to us FROM A HUMAN within a recent window. That catches the one race that
    // actually bites (a human's first post to the Conductor in a brand-new room) without
    // replaying agent-to-agent dispatches (which deliver live and would otherwise cascade).
    const CATCHUP_WINDOW_MS = 12 * 60 * 1000;
    const catchUp = async (): Promise<void> => {
      const rt = (agent as { runtime?: AgentRuntimeLike }).runtime;
      const link = rt?.link;
      if (!rt?.bootstrapRoomMessage || !link?.listAllChats || !link.rest?.listMessages) return;
      let chats: Array<{ id?: unknown; updated_at?: unknown; room?: { id?: unknown } }> = [];
      try { chats = await link.listAllChats(); } catch { return; } // optional SDK feature; skip if unsupported
      for (const chat of chats ?? []) {
        const roomId = typeof chat?.id === 'string' ? chat.id : typeof chat?.room?.id === 'string' ? chat.room.id : null;
        if (!roomId) continue;
        // Skip rooms with no recent activity, so we only poll messages where a catch-up
        // could matter (keeps this cheap across many rooms).
        const ua = typeof chat?.updated_at === 'string' ? chat.updated_at : null;
        if (ua && Date.now() - new Date(ua).getTime() > CATCHUP_WINDOW_MS) continue;
        let data: PlatformChatMsg[] = [];
        try { data = (await link.rest.listMessages({ chatId: roomId, page: 1, pageSize: 10 })).data ?? []; } catch { continue; }
        if (!data.length) continue;
        const latest = [...data].sort((a, b) => new Date(a.inserted_at).getTime() - new Date(b.inserted_at).getTime())[data.length - 1];
        if (!latest?.id || seen.has(latest.id)) continue;
        if (latest.sender_id === config.agentId) { markSeen(latest.id); continue; } // our own message
        const fromHuman = String(latest.sender_type ?? '').toLowerCase() === 'user';
        const mine = (latest.metadata?.mentions ?? []).some((x) => x?.id === config.agentId);
        const fresh = Date.now() - new Date(latest.inserted_at).getTime() < CATCHUP_WINDOW_MS;
        if (!fromHuman || !mine || !fresh) { markSeen(latest.id); continue; } // human @mention to us only
        dbg(`${opts.name} catch-up replay <- ${latest.sender_name ?? latest.sender_type}: ${(latest.content ?? '').slice(0, 80)}`);
        try {
          await rt.bootstrapRoomMessage(roomId, {
            id: latest.id, roomId, content: latest.content ?? '', senderId: latest.sender_id,
            senderType: String(latest.sender_type ?? 'user').toLowerCase(), senderName: latest.sender_name ?? null,
            messageType: latest.message_type ?? 'chat', metadata: latest.metadata ?? {}, createdAt: new Date(latest.inserted_at),
          });
        } catch (e) { dbg(`${opts.name} catch-up error: ${(e as Error)?.message ?? String(e)}`); }
        markSeen(latest.id);
      }
    };

    const tick = (): void => { subscribeRooms(); void catchUp(); };
    const initial = setTimeout(tick, 1500);
    const interval = setInterval(tick, 8000);
    return {
      stop: async () => {
        clearTimeout(initial);
        clearInterval(interval);
        await agent.stop();
      },
    };
  }

  /**
   * Connect an agent that runs on a DIFFERENT framework adapter than the
   * GenericAdapter the other agents use (for example the SDK's OpenAI tool-calling
   * adapter from buildCrossFrameworkAdapter). The caller builds the adapter; here
   * we just create and run the Agent, so the room visibly spans frameworks. The
   * adapter drives the room tools itself, so there is no onMessage handler.
   */
  async connectFrameworkAgent(opts: {
    name: string;
    adapter: Parameters<typeof Agent.create>[0]['adapter'];
    envPrefix?: string;
    apiKey?: string;
    agentId?: string;
  }): Promise<AgentConnection> {
    const config = opts.envPrefix
      ? loadAgentConfigFromEnv({ prefix: opts.envPrefix })
      : opts.apiKey
        ? { agentId: opts.agentId ?? '', apiKey: opts.apiKey }
        : loadAgentConfigFromEnv();
    const agent = Agent.create({ adapter: opts.adapter, config });
    dbg(`${opts.name} (cross-framework) connecting (${config.agentId})`);
    void agent.run({ signals: false });
    const subscribeRooms = (): void => {
      const link = (agent as { runtime?: { link?: { subscribeAgentRooms?: () => Promise<void> } } })?.runtime?.link;
      try {
        void link?.subscribeAgentRooms?.();
      } catch (e) {
        dbg(`${opts.name} subscribe error: ${(e as Error)?.message ?? String(e)}`);
      }
    };
    const initial = setTimeout(subscribeRooms, 1500);
    const interval = setInterval(subscribeRooms, 8000);
    return {
      stop: async () => {
        clearTimeout(initial);
        clearInterval(interval);
        await agent.stop();
      },
    };
  }

  /**
   * Connect the intake/relay agent and return controls to drive a room
   * proactively. The campaign portal uses this to create a room, add the
   * reviewer agents, and post the campaign so band.ai (not the app) runs the
   * review.
   */
  async connectIntake(opts: { envPrefix?: string; name?: string } = {}): Promise<IntakeControl> {
    const config = opts.envPrefix ? loadAgentConfigFromEnv({ prefix: opts.envPrefix }) : loadAgentConfigFromEnv();
    const agent = Agent.create({ adapter: new GenericAdapter(async () => {}), config });
    dbg(`${opts.name ?? 'Intake'} connecting (${config.agentId})`);
    void agent.run({ signals: false });

    let rest: IntakeRest | undefined;
    for (let i = 0; i < 20; i += 1) {
      rest = (agent as { runtime?: { link?: { rest?: IntakeRest } } })?.runtime?.link?.rest;
      if (rest?.createChat && rest.addChatParticipant && rest.createChatMessage) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!rest?.createChat || !rest.addChatParticipant || !rest.createChatMessage) {
      throw new Error('Intake REST facade unavailable (agent.runtime.link.rest)');
    }
    // Call methods on the facade (not extracted) so `this` stays bound to it.
    const api = rest;
    const onTaskBind: TaskBindNote = (roomId, taskId) => dbg(`room ${roomId} bound to task ${taskId}`);
    return buildIntakeControl(api, onTaskBind, async () => {
      await agent.stop();
    });
  }

  /**
   * Connect a lightweight agent and return a Band-native shared-context store for
   * a room: publish the brand DNA and rulebooks into the room as a tagged message
   * and rehydrate them via the /context endpoint (getChatContext), instead of a
   * local store and without the gated Memory tools. Mirrors connectIntake.
   */
  async connectContext(opts: { envPrefix?: string; name?: string } = {}): Promise<SharedContextStore & { stop(): Promise<void> }> {
    const config = opts.envPrefix ? loadAgentConfigFromEnv({ prefix: opts.envPrefix }) : loadAgentConfigFromEnv();
    const agent = Agent.create({ adapter: new GenericAdapter(async () => {}), config });
    dbg(`${opts.name ?? 'Context'} connecting (${config.agentId})`);
    void agent.run({ signals: false });

    let rest: ContextRest | undefined;
    for (let i = 0; i < 20; i += 1) {
      rest = (agent as { runtime?: { link?: { rest?: ContextRest } } })?.runtime?.link?.rest;
      if (rest?.createChatMessage && rest.getChatContext) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!rest?.createChatMessage || !rest.getChatContext) {
      throw new Error('Context REST facade unavailable (agent.runtime.link.rest getChatContext/createChatMessage)');
    }
    const store = makeBandSharedContext(rest);
    return {
      publish: (roomId, payload) => store.publish(roomId, payload),
      rehydrate: (roomId) => store.rehydrate(roomId),
      stop: async () => {
        await agent.stop();
      },
    };
  }
}

function toRoomMessage(pm: BandPlatformMessage): RoomMessage {
  const rawMentions: unknown = pm.metadata?.['mentions'] ?? [];
  const mentions: Mention[] = Array.isArray(rawMentions) ? rawMentions.map(normalizeMention) : [];
  return {
    id: pm.id,
    roomId: pm.roomId,
    content: stripMentionMarkup(pm.content),
    senderId: pm.senderId,
    senderType: (pm.senderType ?? '').toLowerCase(),
    senderName: pm.senderName,
    messageType: pm.messageType,
    mentions,
    metadata: pm.metadata ?? {},
    createdAt: pm.createdAt instanceof Date ? pm.createdAt : new Date(),
  };
}

function normalizeMention(m: unknown): Mention {
  if (typeof m === 'string') return { id: m };
  const o = (m ?? {}) as { id?: string; handle?: string; name?: string; username?: string };
  return {
    id: o.id ?? '',
    ...(o.handle ? { handle: o.handle } : {}),
    ...(o.name ? { name: o.name } : {}),
    ...(o.username ? { username: o.username } : {}),
  };
}

// band.ai prepends @[[uuid]] mention markup to delivered message content; strip
// it so agents see clean text/JSON.
function stripMentionMarkup(content: string): string {
  return content.replace(/@\[\[[^\]]*\]\]/g, '').replace(/^\s+/, '');
}

function wrapTools(t: BandToolsLike, agentName: string, emit: EmitActivity): RoomTools {
  return {
    capabilities: t.capabilities ?? { peers: false, contacts: false, memory: false },
    sendMessage: async (content: string, mentions?: MentionInput) => {
      dbg(`${agentName} -> message: ${content.slice(0, 100)}`);
      emit('message', content, 'chat');
      await t.sendMessage(content, mentions);
    },
    sendEvent: async (content: string, messageType: string, metadata?: Record<string, unknown>) => {
      // band.ai accepts only a fixed set of event types; map our semantic labels to 'thought'.
      const allowed = new Set(['tool_call', 'tool_result', 'thought', 'error', 'task']);
      const type = allowed.has(messageType) ? messageType : 'thought';
      dbg(`${agentName} -> event(${messageType}): ${content.slice(0, 100)}`);
      emit('event', content, messageType);
      await t.sendEvent(content, type, metadata);
    },
    getParticipants: async (): Promise<Participant[]> => {
      try {
        const ps = await t.getParticipants();
        dbg(`${agentName} getParticipants -> ${ps?.length ?? 0}: [${(ps ?? []).map((p) => `${p.name}:${p.type}`).join(', ')}]`);
        return (ps ?? []).map(toParticipant);
      } catch (e) {
        dbg(`${agentName} getParticipants error: ${(e as Error)?.message ?? String(e)}`);
        return [];
      }
    },
    addParticipant: async (name: string, role?: string) => {
      await t.addParticipant(name, role);
    },
    lookupPeers: async (page?: number, pageSize?: number): Promise<Peer[]> => {
      if (!t.lookupPeers) return [];
      const res = await t.lookupPeers(page, pageSize);
      const items = Array.isArray(res) ? res : ((res as { items?: unknown[] })?.items ?? []);
      return items.map((p) => toParticipant(p as Parameters<typeof toParticipant>[0]));
    },
  };
}

function toParticipant(p: {
  id?: string;
  name?: string;
  type?: string;
  handle?: string | null;
  role?: string;
}): Participant {
  const out: Participant = {
    id: p.id ?? '',
    name: p.name ?? '',
    handle: p.handle ?? p.name ?? '',
    type: (p.type ?? '').toLowerCase() === 'agent' ? 'agent' : 'user',
  };
  if (p.role) out.role = p.role;
  return out;
}
