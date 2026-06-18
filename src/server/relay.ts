// Chat relay: lets a judge talk to the band.ai agents from OUR UI with no auth.
//
// The server connects ONE Band identity (the INTAKE agent) and drives a real
// band.ai room on the judge's behalf: create the room, add the Conductor, post the
// judge's messages, and read the agents' replies back out. The judge never logs in;
// our server is the only authenticated party. The reviewer agents run as their own
// always-on process (src/run/agents.ts) and self-assemble once the Conductor is
// @mentioned (see src/board/pod-board.ts: the human only adds the Conductor).
//
// Everything band.ai-specific (which identity posts, the Conductor's handle / the id
// used to add it as a participant) is env-configurable so it can be tuned against the
// live system without a code change. With no relay credentials the routes degrade to
// a clear 503 rather than throwing.

import { RealBandTransport, type RelayConnection, type RelayMessage } from '../band/real';

export type { RelayMessage } from '../band/real';

// Which env-prefixed identity the relay connects as (PREFIX_AGENT_ID / PREFIX_API_KEY).
const RELAY_ENV_PREFIX = process.env.RELAY_ENV_PREFIX ?? 'INTAKE';
// The Conductor we @mention. add_participant on band.ai resolves by the registered
// agent NAME (per pod-board.ts), so the participant identifier defaults to the name.
const CONDUCTOR_HANDLE = process.env.CONDUCTOR_HANDLE ?? '@conductor';
const CONDUCTOR_PARTICIPANT = process.env.CONDUCTOR_PARTICIPANT ?? 'Conductor';
const CONDUCTOR_ID = process.env.COORDINATOR_AGENT_ID ?? process.env.CONDUCTOR_AGENT_ID ?? CONDUCTOR_PARTICIPANT;

/** True when the relay identity's credentials are present (else the routes 503). */
export function relayConfigured(): boolean {
  return Boolean(process.env[`${RELAY_ENV_PREFIX}_API_KEY`] && process.env[`${RELAY_ENV_PREFIX}_AGENT_ID`]);
}

/**
 * The opening message that kicks off a review. The Conductor parses
 * "review <campaign> [advertisement]" (see agents.ts lookupMaterials), so we name
 * the campaign and (optionally) the advertisement plainly and @mention by handle.
 */
export function buildReviewPrompt(campaignName: string, advertisementName?: string): string {
  const target = advertisementName ? `the "${advertisementName}" advertisement of the "${campaignName}" campaign` : `the "${campaignName}" campaign`;
  return `${CONDUCTOR_HANDLE} review ${target}.`;
}

/**
 * Given the ids we have already streamed and the latest room messages, return only
 * the messages not seen yet (in chronological order). Pure, so the SSE poller's
 * dedup is unit-testable. Mutates `seen` to mark the returned ids.
 */
export function selectNewMessages(seen: Set<string>, messages: RelayMessage[]): RelayMessage[] {
  const fresh: RelayMessage[] = [];
  for (const m of messages) {
    if (!m.id || seen.has(m.id)) continue;
    seen.add(m.id);
    fresh.push(m);
  }
  return fresh;
}

// Lazily-connected singleton: the relay identity connects on first use and is reused
// across rooms (one band.ai agent participates in many chats). A failed connect is
// not cached, so the next request retries.
let relayPromise: Promise<RelayConnection> | null = null;
function relay(): Promise<RelayConnection> {
  if (!relayPromise) {
    relayPromise = new RealBandTransport()
      .connectRelay({ envPrefix: RELAY_ENV_PREFIX, name: 'Relay' })
      .catch((err) => {
        relayPromise = null;
        throw err;
      });
  }
  return relayPromise;
}

/** Create a room, add the Conductor, and post the opening review message. Returns the room id. */
export async function createReviewRoom(opts: { campaignName: string; advertisementName?: string }): Promise<string> {
  const r = await relay();
  // No task id: band.ai requires task_id to be a UUID, and our campaign ids are
  // slugs (e.g. "immune-plus-q3"). The chat relay does not need a Band task binding.
  const roomId = await r.control.createRoom();
  await r.control.addParticipant(roomId, CONDUCTOR_ID, 'member');
  await r.control.postMessage(roomId, buildReviewPrompt(opts.campaignName, opts.advertisementName), [
    { id: CONDUCTOR_ID, handle: CONDUCTOR_HANDLE },
  ]);
  return roomId;
}

/** Post a judge's free-text message into the room, @mentioning the Conductor. */
export async function postUserMessage(roomId: string, text: string): Promise<void> {
  const r = await relay();
  await r.control.postMessage(roomId, text, [{ id: CONDUCTOR_ID, handle: CONDUCTOR_HANDLE }]);
}

/** Read the room's recent messages (agent replies + our posts), normalized for the UI. */
export async function listRoomMessages(roomId: string, pageSize = 50): Promise<RelayMessage[]> {
  const r = await relay();
  return r.listMessages(roomId, pageSize);
}
