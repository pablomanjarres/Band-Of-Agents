// Transport-agnostic contracts for the Band coordination layer.
// These mirror the @band-ai/sdk surface (GenericAdapter handler + tools) so the
// real transport and the in-process fake are interchangeable behind one seam.

export interface Mention {
  id: string;
  handle?: string;
  name?: string;
  username?: string;
}

export type MentionInput = string[] | Mention[];

export interface Participant {
  id: string;
  name: string;
  handle: string;
  type: 'agent' | 'user';
  role?: string;
}

export type Peer = Participant;

/**
 * A raw unit of room activity (a message or a visible event) as emitted by a
 * transport for observation. The server translates these into UI-facing
 * BoardEvents and streams them to the console over SSE.
 */
export interface BoardActivity {
  kind: 'message' | 'event';
  roomId: string;
  fromId: string;
  fromName: string;
  content: string;
  messageType: string;
  mentions: Mention[];
  metadata?: Record<string, unknown>;
  seq: number;
}

export type ActivityCallback = (activity: BoardActivity) => void;

/** A message as an agent receives it (normalized PlatformMessage). */
export interface RoomMessage {
  id: string;
  roomId: string;
  content: string;
  senderId: string;
  senderType: string;
  senderName: string | null;
  messageType: string;
  mentions: Mention[];
  metadata: Record<string, unknown>;
  createdAt: Date;
}

/** The tools an agent uses to act in a room (maps to @band-ai/sdk tools). */
export interface RoomTools {
  readonly capabilities: { peers: boolean; contacts: boolean; memory: boolean };
  /** Post a message; requires at least one @mention to route (enforces directed comms). */
  sendMessage(content: string, mentions?: MentionInput): Promise<void>;
  /** Post a visible thought/status/audit event; no mention required, pings no one. */
  sendEvent(content: string, messageType: string, metadata?: Record<string, unknown>): Promise<void>;
  getParticipants(): Promise<Participant[]>;
  addParticipant(name: string, role?: string): Promise<void>;
  lookupPeers(page?: number, pageSize?: number): Promise<Peer[]>;
}

export interface AgentContext {
  roomId: string;
  agentId: string;
  agentName: string;
}

/** An agent's behavior: invoked when a message it should see arrives. */
export type AgentHandler = (
  message: RoomMessage,
  tools: RoomTools,
  context: AgentContext,
) => Promise<void>;

export interface ConnectOptions {
  agentId: string;
  name: string;
  handle: string;
  onMessage: AgentHandler;
  /** Real transport only: env prefix to load PREFIX_AGENT_ID / PREFIX_API_KEY. */
  envPrefix?: string;
  /** Real transport only: explicit API key (alternative to envPrefix). */
  apiKey?: string;
}

export interface AgentConnection {
  stop(): Promise<void>;
}

/** Connects agents to a room. Implemented by RealBandTransport and FakeBandTransport. */
export interface BandTransport {
  connectAgent(opts: ConnectOptions): Promise<AgentConnection>;
}

/** A mention reference for a band.ai message (the participant UUID, plus hints). */
export interface MentionRef {
  id: string;
  handle?: string;
  name?: string;
}

/**
 * Controls for driving a band.ai room proactively as the intake/relay agent:
 * create the room, add the reviewer agents, and post the campaign so band.ai
 * runs the review. Returned by RealBandTransport.connectIntake(). createRoom
 * optionally binds the room to a task id (the asset id), so the room carries
 * Band task state for the review case.
 */
export interface IntakeControl {
  createRoom(taskId?: string): Promise<string>;
  addParticipant(roomId: string, agentId: string, role?: string): Promise<void>;
  postMessage(roomId: string, content: string, mentions: MentionRef[]): Promise<void>;
  stop(): Promise<void>;
}
