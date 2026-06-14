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

    const adapter = new GenericAdapter(async (raw: unknown): Promise<void> => {
      const args = raw as BandAdapterArgs;
      const message = toRoomMessage(args.message);
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
      dbg(`${opts.name} subscribeAgentRooms: link=${!!link} method=${typeof link?.subscribeAgentRooms}`);
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
    return {
      createRoom: async () => (await api.createChat!()).id,
      addParticipant: async (roomId, agentId, role = 'member') => {
        await api.addChatParticipant!(roomId, { participantId: agentId, role });
      },
      postMessage: async (roomId, content, mentions) => {
        await api.createChatMessage!(roomId, { content, mentions });
      },
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
