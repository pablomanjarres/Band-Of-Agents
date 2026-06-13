// Real band.ai transport: wraps @band-ai/sdk. Each connectAgent() creates a
// GenericAdapter-backed Agent, adapts Band's message/tools shape to our seam,
// and runs it (non-blocking) so several agents can run in one process. Set
// BAND_DEBUG=1 to trace inbound/outbound activity to stderr.

import { Agent, GenericAdapter, loadAgentConfigFromEnv } from '@band-ai/sdk';
import type {
  AgentConnection,
  BandTransport,
  ConnectOptions,
  Mention,
  MentionInput,
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

export class RealBandTransport implements BandTransport {
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
      const tools = wrapTools(args.tools, opts.name);
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
    return {
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

function wrapTools(t: BandToolsLike, agentName: string): RoomTools {
  return {
    capabilities: t.capabilities ?? { peers: false, contacts: false, memory: false },
    sendMessage: async (content: string, mentions?: MentionInput) => {
      dbg(`${agentName} -> message: ${content.slice(0, 100)}`);
      await t.sendMessage(content, mentions);
    },
    sendEvent: async (content: string, messageType: string, metadata?: Record<string, unknown>) => {
      // band.ai accepts only a fixed set of event types; map our semantic labels to 'thought'.
      const allowed = new Set(['tool_call', 'tool_result', 'thought', 'error', 'task']);
      const type = allowed.has(messageType) ? messageType : 'thought';
      dbg(`${agentName} -> event(${messageType}): ${content.slice(0, 100)}`);
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
