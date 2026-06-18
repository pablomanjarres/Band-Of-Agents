# Judge chat relay: talk to the band.ai agents from our UI (no auth)

Date: 2026-06-18
Status: approved (design), implementing

## Problem

Judges should be able to use the real Band workflow from OUR product, with no
band.ai login. Today the only way to talk to the agents is in app.band.ai (which
requires auth and is a separate surface). We want a chat panel inside our SPA where
a judge opens a review chat for a campaign and converses with the agents; the real
agents collaborate in a real band.ai room, and replies stream back into our UI.

## Constraints / decisions (confirmed with user)

- No auth for judges. Our server acts on their behalf using server-side Band creds.
- Reuse the existing `INTAKE_AGENT_ID` / `INTAKE_API_KEY` identity as the human/poster.
- Agents run always-on in the cloud (a separate `band-agents` Cloud Run service), so
  judging does not depend on a laptop process.
- Entry point: per-campaign "Open review chat" button (seeds a review of that campaign).
- This must stay TRUE to Band as the coordination layer (no bypass that fakes it).

## Architecture

```
Judge (our SPA, no login)
  campaign page ──"Open review chat"──> POST /api/rooms {campaignId, advertisementId?}
                                          band-backend (relay, INTAKE creds):
                                            createRoom -> addParticipant(cast) -> postMessage(@Conductor "review <campaign>")
  chat panel ── types message ─────────> POST /api/rooms/:id/messages {text}
                                            relay: postMessage(roomId, text, @Conductor)
  chat panel <── SSE stream ───────────  GET /api/rooms/:id/events
                                            relay polls rest.listMessages(roomId), emits new msgs (deduped)

band.ai room  <── reviewer agents (band-agents Cloud Run service, BOARD_MODE=band-ish runner = src/run/agents.ts)
                  auto-subscribe to the new room, debate, and reply.
```

Two Cloud Run services:
- `band-backend` (existing): the dashboard API + the NEW relay routes. Stays
  `BOARD_MODE=local` so the dashboard is unchanged. Gains a self-contained relay
  module that connects ONLY the INTAKE identity to band.ai (lazy, on first use).
- `band-agents` (new): runs `src/run/agents.ts` always-on (min-instances=1,
  CPU always allocated, `IMAGE_PORT=$PORT` for the Cloud Run health probe). Holds the
  per-agent Band creds + model provider env. Replaces the laptop agents process.

## Components

### 1. Relay module (`src/server/relay.ts`, new)
A small, lazily-initialized singleton:
- `getRelay()`: on first call, `new RealBandTransport().connectIntake({ envPrefix: 'INTAKE' })`
  and capture the underlying `rest` facade (createChat/addChatParticipant/
  createChatMessage/listMessages) from the connected agent runtime.
- `createReviewRoom({campaignId, advertisementId?})`: createRoom(taskId=campaignId) ->
  addParticipant for the reviewer agent ids + the Conductor -> postMessage
  "@Conductor review <campaign name> [advertisement]". Returns `{ roomId }`.
- `postUserMessage(roomId, text)`: postMessage(roomId, text, [@Conductor]).
- `listRoomMessages(roomId, sinceSeq?)`: rest.listMessages -> normalized
  `{ id, senderName, senderType, content, ts }[]`, sorted, for the SSE poller.
- Agent ids come from env (`*_AGENT_ID`), reusing the same names `agents.ts` uses
  (Conductor = COORDINATOR_AGENT_ID; reviewers from their PREFIX_AGENT_ID). If a
  given id is absent, skip it (graceful: at minimum the Conductor must be present).
- Total/graceful: if INTAKE creds are missing, the routes return 503 with a clear
  message rather than throwing.

### 2. Backend routes (`src/server/index.ts`)
- `POST /api/rooms` -> `createReviewRoom(body)` -> `{ roomId }`.
- `POST /api/rooms/:id/messages` -> `postUserMessage` -> `{ ok: true }`.
- `GET /api/rooms/:id/events` (SSE) -> poll `listRoomMessages` every ~2s, emit each
  new message as a `data:` event (deduped by message id); heartbeat comment to keep
  the connection open; closes on client disconnect. Mirrors the existing SSE style in
  `subscribeSSE` / the reviews event stream.

### 3. Chat UI (web SPA)
- `web/src/components/ReviewChat.tsx`: a slide-over/panel with a message list
  (human vs agent bubble styling, sender label), an input + send, an empty/seeding
  state, and live updates via `EventSource('/api/rooms/:id/events')`.
- `web/src/api.ts`: `createRoom(body)`, `postRoomMessage(id, text)`,
  `subscribeToRoomEvents(id, onEvent)` (EventSource), with the existing `asJson` helper.
- Entry point: an "Open review chat" button on the campaign / advertisement view
  (CampaignDetailPage) that calls `createRoom({campaignId, advertisementId})` and
  opens `ReviewChat` on the returned roomId.

### 4. Deploy (`band-agents` service)
- A `Dockerfile.agents` (or reuse the existing Dockerfile with a different CMD) whose
  CMD runs `src/run/agents.ts`; `IMAGE_PORT=$PORT` so the health probe passes.
- `gcloud run deploy band-agents --source . --region us-east1 --no-cpu-throttling
  --min-instances=1 ...` with the Band + model env. (Run with user approval; needs
  the real secret values from `.env`.)
- band-backend env gains `INTAKE_AGENT_ID`, `INTAKE_API_KEY`, and the `*_AGENT_ID`
  participant ids (no secret reviewer API keys needed there; the relay only posts/reads
  as INTAKE and adds participants by id).

## Data flow / error handling

- Room creation failure (Band down / bad creds): route returns 502/503; UI shows a
  friendly "couldn't start the chat" with retry.
- SSE poll errors: logged, the stream keeps trying; UI shows a subtle "reconnecting".
- No message duplication: poller tracks seen message ids per stream; UI also keys by id.
- Latency: agent replies can take many seconds (model calls). UI shows a "Conductor is
  working..." affordance while awaiting the next agent message.

## Testing

- Unit: `listRoomMessages` normalization + dedup (pure, with a stub rest facade);
  `createReviewRoom` calls createRoom/addParticipant/postMessage in order (stub IntakeControl).
- Route: POST /api/rooms and /messages happy-path + 503-when-no-creds (app.fetch).
- Manual end-to-end (as a judge): open a campaign, click "Open review chat", send a
  message, see the Conductor + reviewers reply in our panel, with band-agents live.

## Out of scope (YAGNI)

- Multi-user presence, message editing, file uploads in chat, persistence of chat
  history beyond what band.ai stores, auth/accounts. The relay is stateless beyond the
  per-request Band calls; band.ai is the source of truth for messages.

## Build order

1. Relay module + unit tests.
2. Backend routes + route tests.
3. Chat UI + api client + campaign entry point.
4. Wire INTAKE + agent ids into band-backend env (user-approved gcloud).
5. Deploy band-agents service (user-approved gcloud).
6. End-to-end test as a judge.
