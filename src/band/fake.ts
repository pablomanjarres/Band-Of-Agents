// In-process Band room used for development and deterministic tests, before any
// band.ai credentials exist. It simulates message delivery by @mention and
// records a transcript so tests can assert on the debate.
//
// This is a dev/test harness only. The hackathon submission runs on real band.ai
// (the platform may not be used as a thin wrapper); the fake never substitutes
// for that, it only makes the reasoning/negotiation logic fast to build and test.

import type {
  ActivityCallback,
  AgentConnection,
  AgentContext,
  AgentHandler,
  BandTransport,
  ConnectOptions,
  IntakeControl,
  Mention,
  MentionInput,
  MentionRef,
  Participant,
  RoomMessage,
  RoomTools,
} from './types';

export interface TranscriptEntry {
  kind: 'message' | 'event';
  fromId: string;
  fromName: string;
  content: string;
  messageType: string;
  mentions: Mention[];
  metadata: Record<string, unknown>;
  seq: number;
}

interface Registered {
  id: string;
  name: string;
  handle: string;
  type: 'agent' | 'user';
  role?: string;
  handler?: AgentHandler;
}

function normalizeMentions(input: MentionInput | undefined): Mention[] {
  if (!input) return [];
  return input.map((m) => (typeof m === 'string' ? { id: m } : m));
}

export class FakeBandTransport implements BandTransport {
  readonly roomId: string;
  readonly transcript: TranscriptEntry[] = [];
  private readonly participants = new Map<string, Registered>();
  private readonly agents = new Map<string, Registered>();
  private readonly queue: Array<() => Promise<void>> = [];
  private running = false;
  private seq = 0;

  private readonly onActivity?: ActivityCallback;

  constructor(roomId = 'room-local', opts: { onActivity?: ActivityCallback } = {}) {
    this.roomId = roomId;
    this.onActivity = opts.onActivity;
  }

  /** Seed a non-agent participant (e.g. the marketing lead, or a test poster). */
  addUser(id: string, name: string, handle: string = name): void {
    this.participants.set(id, { id, name, handle, type: 'user' });
  }

  /**
   * Seed a participant of either type with an explicit handle. Used to register
   * the intake relay (an agent, since the band.ai SDK posts only as an agent) so
   * its posts are recognized by the coordinator's intake gate. A participant with
   * no handler never has messages delivered to it; it can only post.
   */
  addParticipant(id: string, name: string, handle: string = name, type: 'agent' | 'user' = 'user'): void {
    if (this.participants.has(id)) return;
    this.participants.set(id, { id, name, handle, type });
  }

  connectAgent(opts: ConnectOptions): Promise<AgentConnection> {
    const reg: Registered = {
      id: opts.agentId,
      name: opts.name,
      handle: opts.handle,
      type: 'agent',
      handler: opts.onMessage,
    };
    this.participants.set(opts.agentId, reg);
    this.agents.set(opts.agentId, reg);
    const connection: AgentConnection = {
      stop: async () => {
        this.agents.delete(opts.agentId);
      },
    };
    return Promise.resolve(connection);
  }

  /**
   * External injection: a human or the test harness posts into a room. The
   * optional roomId targets a specific room (defaulting to the constructor room),
   * so ONE fake transport can host MANY rooms with the same connected agents,
   * exactly like one band.ai agent serving every chat it is a member of. This is
   * what lets a campaign fan out into one room per material over a single fake.
   */
  post(fromId: string, content: string, mentions?: MentionInput, roomId: string = this.roomId): void {
    this.record('message', fromId, content, 'chat', normalizeMentions(mentions), {}, roomId);
  }

  private toolsFor(agentId: string, roomId: string): RoomTools {
    return {
      capabilities: { peers: true, contacts: false, memory: false },
      sendMessage: async (content, mentions) => {
        this.record('message', agentId, content, 'chat', normalizeMentions(mentions), {}, roomId);
      },
      sendEvent: async (content, messageType, metadata) => {
        this.record('event', agentId, content, messageType, [], metadata ?? {}, roomId);
      },
      getParticipants: async () => this.listParticipants(),
      addParticipant: async (name, role) => {
        const id = `seeded:${name}`;
        if (!this.participants.has(id)) {
          const entry: Registered = { id, name, handle: name, type: 'user' };
          if (role !== undefined) entry.role = role;
          this.participants.set(id, entry);
        }
      },
      lookupPeers: async () => this.listParticipants(),
    };
  }

  private listParticipants(): Participant[] {
    return [...this.participants.values()].map((p) => {
      const out: Participant = { id: p.id, name: p.name, handle: p.handle, type: p.type };
      if (p.role !== undefined) out.role = p.role;
      return out;
    });
  }

  private record(
    kind: 'message' | 'event',
    fromId: string,
    content: string,
    messageType: string,
    mentions: Mention[],
    metadata: Record<string, unknown>,
    roomId: string = this.roomId,
  ): void {
    const from = this.participants.get(fromId);
    const seq = this.seq++;
    this.transcript.push({
      kind,
      fromId,
      fromName: from?.name ?? fromId,
      content,
      messageType,
      mentions,
      metadata,
      seq,
    });
    this.onActivity?.({
      kind,
      roomId,
      fromId,
      fromName: from?.name ?? fromId,
      content,
      messageType,
      mentions,
      metadata,
      seq,
    });
    if (kind !== 'message') return;
    for (const mention of mentions) {
      const target = this.agents.get(mention.id);
      if (!target?.handler || target.id === fromId) continue;
      const message: RoomMessage = {
        id: `m${seq}`,
        roomId,
        content,
        senderId: fromId,
        senderType: from?.type ?? 'user',
        senderName: from?.name ?? null,
        messageType,
        mentions,
        metadata,
        createdAt: new Date(),
      };
      const handler = target.handler;
      const tools = this.toolsFor(target.id, roomId);
      const ctx: AgentContext = { roomId, agentId: target.id, agentName: target.name };
      this.enqueue(() => handler(message, tools, ctx));
    }
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue.push(task);
    void this.run();
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const task = this.queue.shift();
        if (!task) continue;
        try {
          await task();
        } catch (err) {
          // A model/provider failure degrades one reviewer; it must not crash the run.
          console.error('[board] agent handler error:', (err as Error)?.message ?? String(err));
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** Wait until all queued deliveries have been processed. */
  async drain(): Promise<void> {
    while (this.running || this.queue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}

/**
 * An IntakeControl backed by a FakeBandTransport, so the band CAMPAIGN flow is
 * driveable in-process (no band.ai credentials), exactly like the single-asset
 * band flow is tested. It mirrors RealBandTransport.connectIntake()'s control:
 * createRoom mints a fresh room id (a campaign fans out one room per material),
 * addParticipant is a no-op (the fake's connected agents already serve every
 * room, like one band.ai agent in many chats), and postMessage injects the
 * intake's post into that room as the intake user, mentioning the coordinator so
 * the existing coordinator/reviewer/reconcile machinery runs per room. The intake
 * is seeded as a user named "Intake" so the coordinator's intake-agent gate (or a
 * test's own gate) recognizes it.
 */
export function makeFakeIntakeControl(
  transport: FakeBandTransport,
  opts: { intakeId?: string; intakeName?: string; senderType?: 'agent' | 'user' } = {},
): IntakeControl {
  const intakeId = opts.intakeId ?? 'intake';
  const intakeName = opts.intakeName ?? 'Intake';
  transport.addParticipant(intakeId, intakeName, '@pablomanjarres/intake', opts.senderType ?? 'agent');
  let n = 0;
  return {
    createRoom: async (taskId) => `${transport.roomId}::room-${taskId ?? (n += 1)}`,
    addParticipant: async () => {},
    postMessage: async (roomId: string, content: string, mentions: MentionRef[]) => {
      transport.post(intakeId, content, mentions.map((m) => ({ id: m.id })), roomId);
    },
    stop: async () => {},
  };
}

