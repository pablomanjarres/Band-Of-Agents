# Design Spec: Multi-Region Marketing Compliance Review Board (on Band / band.ai)

Status: approved design, 2026-06-13. Source of intent: `.private/context/PROJECT_BRIEF.md`, `ARCHITECTURE.md`, `BUILD_PLAN.md`, `REGIONS_APPROACH.md`. This spec operationalizes those into a buildable design. Repo writing rule: no em dashes anywhere. Platform is band.ai (the SDK ships as `@band-ai/sdk`); "thenvoi" is the legacy alias and is avoided in code and docs.

## 1. One-paragraph overview
A Band room ("review board") where specialist agents with competing mandates review one marketing asset against a shared brand DNA plus per-region rulebooks, debate through Band, and reconcile to a per-region verdict (publish, adapt, or escalate). The originality is the conflict: a claim that is fine in the US can be unlawful in the EU, so the US and EU reviewers genuinely disagree on the same asset, the reconcile agent negotiates, and a true deadlock escalates to a human. A remediation agent then rewrites non-compliant copy and regenerates a localized visual (Nano Banana) and sends the asset back into review. This is not a linear pipeline; coordination, disagreement, and escalation are the center.

## 2. The win condition (do not lose this)
The reviewers hold mandates in genuine tension (US "ship if substantiated" vs EU "pre-authorization plus mandatory disclosures" vs brand "stay on-voice"). The system must adjudicate a real tradeoff, not merge a list of flags. If the agents only pass output down a line, the project loses. Keep negotiation, disagreement, and escalation through Band at the center. Minimum winning version is rungs 1 to 5 below.

## 3. Stack (verified by research, 2026-06-13)
- TypeScript, Node 22+, pnpm, ESM.
- Band SDK: `@band-ai/sdk` v0.1.6 (the package also publishes as `@thenvoi/sdk`; we use the band-ai name). Node >=22, ESM. `Agent.create({ adapter, config })` then `await agent.run()` (connects WebSocket via Phoenix Channels, auto-joins assigned rooms, installs signal handlers).
- Agents are registered in the band.ai web app (app.band.ai), type "External", which yields a UUID plus an API key shown once (format `band_a_...`) plus a handle like `@pablomanjarres/coordinator`. The SDK only connects an already-registered agent; it does not create the identity. Rooms can be created in the app or via `tools.createChatroom(taskId?)`.
- Per-agent credentials via `loadAgentConfigFromEnv({ prefix })` reading `PREFIX_AGENT_ID` and `PREFIX_API_KEY`. Each agent gets its own prefix (`COORDINATOR`, `US`, `EU`, `BRAND`, `RECONCILE`, `REMEDIATION`). Optional endpoint overrides `BAND_REST_URL` / `BAND_WS_URL` default to Band Cloud.

### Band coordination primitives (exact, from SDK source)
- `tools.sendMessage(content, mentions?)`: post to room; requires at least one @mention to route (enforces directed, non-pipeline communication). `mentions` is `MentionReference[]` = `[{ id, handle?, name?, username? }]`. LLM tool name `band_send_message`/`thenvoi_send_message`.
- `tools.sendEvent(content, messageType, metadata?)`: post a visible "thought"/status/audit event, no mention required. Used for visible reasoning so the debate is legible to judges without pinging everyone.
- `tools.createChatroom(taskId?)`, `tools.addParticipant(name, role?)`, `tools.removeParticipant(name)`, `tools.getParticipants()`, `tools.lookupPeers(page?, pageSize?)` (gate on `tools.capabilities.peers`).
- `tools.capabilities = { peers, contacts, memory }`. Do not depend on Memory (per CLAUDE.md); keep shared state in workspace files and the room context.
- Room context rehydration: `RestApi.getChatContext({ chatId, page?, pageSize? })` from `@band-ai/sdk/rest`; the runtime also hands `history` into each adapter call automatically.
- Inbound `message` (PlatformMessage): `{ id, roomId, content, senderId, senderType, senderName, messageType, metadata, createdAt }`; mentions arrive under `metadata.mentions`.

## 4. Model layer: AIML is the architectural main path
A single provider-agnostic interface, with one switch `MODEL_MODE`.

```
interface ModelClient {
  complete(req: { system?: string; messages: Msg[]; jsonSchema?: JsonSchema; effort?: 'low'|'medium'|'high' }): Promise<{ text: string; json?: unknown }>
  generateImage(req: { prompt: string; aspectRatio?: string }): Promise<{ url?: string; b64?: string }>
}
```

- `MODEL_MODE=aiml` (the "full AIML" main path, prize target): every chat agent calls the official `openai` npm SDK pointed at `https://api.aimlapi.com/v1` (AIML is OpenAI-compatible). Construct once: `new OpenAI({ apiKey: process.env.AIML_API_KEY, baseURL: 'https://api.aimlapi.com/v1' })`; per-agent model is a slug. Read `completion.choices[0].message.content`.
- `MODEL_MODE=dev` (cost-saver, conserves AIML credit during testing): routes to the same model families via the providers `noelle` already uses:
  - Claude: `@anthropic-ai/bedrock-sdk`, `new AnthropicBedrock({ awsRegion: process.env.AWS_REGION ?? 'us-east-1' })` (no key fields; AWS default provider chain reads `~/.aws/credentials` and `AWS_PROFILE`; SDK ignores `~/.aws/config` for region, so `AWS_REGION` must be set). Mirrors the first-party Messages API (tool use, `output_config.format` JSON, adaptive thinking).
  - Gemini: `@google/genai` v2.8.0 Vertex mode, `new GoogleGenAI({ vertexai: true, project, location })` (ADC via `gcloud auth application-default login`, spends GCP credits). Env: `GOOGLE_GENAI_USE_VERTEXAI=true`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`. JSON via `config.responseMimeType='application/json'` plus `config.responseSchema`.
  - OpenAI direct if needed: `openai` with `OPENAI_API_KEY`.
- Nano Banana (image regen) is AIML only: `POST https://api.aimlapi.com/v1/images/generations`, model `google/gemini-2.5-flash-image`, body `{ model, prompt, num_images?, aspect_ratio? }`, response `{ images: [{ url, ... }], description }` (may return `b64_json`). Parse `images[0].url`. Separate code path via raw fetch. It is the one capability only AIML provides in our stack, so it is the strongest AIML-prize signal.
- Switchover doc `docs/AIML_SWITCHOVER.md`: to run 100% on AIML, set `MODEL_MODE=aiml` and remove the `dev` entries from the route map. That is the entire "remove every trace of non-AIML usage" procedure.
- Resilience: AIML rate limits are undocumented; wrap all calls with retry/backoff on HTTP 429. Before the demo, smoke-test (a) an AIML chat completion and (b) a Nano Banana generation to confirm the active model ids resolve and the key has image access.

### Allowed model set (constrained to what `noelle` uses; Opus 4.8 is NOT available)
Claude families opus-4-6 / sonnet-4-6 / haiku-4-5; Gemini 2.5 pro / flash; GPT-5 / mini. Exact AIML Claude slugs verified live via `GET https://api.aimlapi.com/models` before the demo (use nearest tier such as `anthropic/claude-sonnet-4.5` / `anthropic/claude-opus-4-5` if 4.6 is absent on AIML).

## 5. Agents and multi-model routing
All agents use Band's `GenericAdapter` so we fully control the debate; the LLM call goes through our `ModelClient`. Each agent runs a different model (satisfies "multi-model by design").

| Agent | Mandate | AIML model (main) | Dev cost-saver |
|---|---|---|---|
| Coordinator/Chair | intake, load context, recruit, drive rounds, detect deadlock | `google/gemini-2.5-flash` | Vertex `gemini-2.5-flash` |
| US reviewer | FTC: ship if substantiated | `anthropic/claude-sonnet-4.5` | Bedrock `us.anthropic.claude-sonnet-4-6` |
| EU reviewer | EU: pre-authorization plus disclosures | `google/gemini-2.5-pro` | Vertex `gemini-2.5-pro` |
| Brand-consistency reviewer | keep localized versions on-voice | `anthropic/claude-haiku-4.5` | Bedrock `us.anthropic.claude-haiku-4-5-20251001-v1:0` |
| Reconcile | detect conflict, negotiate, per-region verdict | `anthropic/claude-opus-4-5` | Bedrock `us.anthropic.claude-opus-4-6-v1` |
| Remediation (enhancement) | rewrite per region, regenerate image | copy `anthropic/claude-sonnet-4.5`; image `google/gemini-2.5-flash-image` | Bedrock sonnet plus AIML image |

Human reviewer (marketing lead) is a Band participant, not an agent; added via `addParticipant` and @mentioned on escalation.

## 6. Shared context: brand DNA plus per-region rulebooks (the moat)
Structured JSON loaded into the room at intake (posted via `sendEvent` so it is visible, and read from a workspace file). Human escalation decisions fold back into the rulebook as precedent so the system learns.

Rule shape: `{ id, region, category, severity: 'block'|'warn', check, required_disclosure: string|null, source_url }`.

US rulebook (6 rules, sourced): objective/quantified claims need competent and reliable scientific evidence before publish; health/efficacy claims need RCT-grade evidence; testimonial claims substantiated as if stated directly plus a typical-results disclosure ("results not typical" is insufficient); material-connection disclosure for endorsers; comparative claims allowed if truthful (no heightened bar); "free" needs clear up-front terms and a 30-day regular-price basis.

EU rulebook (7 rules, sourced): health claims prohibited unless authorised and on the EU Register (pre-authorization); authorised claims must use verbatim registered wording and meet nutrient conditions; Article 10(2) mandatory accompanying statements (balanced diet plus quantity needed), no US analog; no disease prevent/treat/cure framing (risk-reduction needs Article 14 plus the multiple-risk-factors statement); UCPD misleading-by-omission; comparative advertising must satisfy all cumulative conditions including non-denigration; GDPR Article 7 opt-in consent for any data-capture call to action.

Compliance is framing for a hackathon demo, not legal advice; a "NOT legal advice" banner appears in the UI and in agent system prompts. Do not assert a fixed RCT count; treat probiotics/botanicals as contested edge cases; pull exact EU Register claim strings before hardcoding.

## 7. The sample asset (demo money-shot): wellness/supplement brand
Fictional wellness brand. Social post with the claim: "Clinically proven to boost your immune system, 9 out of 10 users felt healthier."
- US reviewer: PASS (mock 2-RCT substantiation file plus typical-results disclosure attached).
- EU reviewer: FAIL on three stacked rules: non-verbatim/unauthorised wording ("boost" vs "contributes to the normal function of"), implied disease/efficacy claim, and missing Article 10(2) disclosures.

That single asset forces the genuine US-says-ship / EU-vetoes deadlock, which drives the reconcile split verdict, the human escalation, and the remediation EU-compliant variant. Brand and asset are swappable inputs.

## 8. Coordination and escalation flow
1. Coordinator loads brand DNA plus region rulebooks into shared context and recruits the region reviewers (dynamic, not a fixed set).
2. US, EU, and brand reviewers review in parallel and post structured findings (each with severity and rationale), @mentioning reconcile; visible reasoning goes via `sendEvent`.
3. Reconcile detects the cross-region conflict (US approve vs EU block on the same span), runs a negotiation turn, and issues a per-region verdict: publish, adapt, or escalate.
4. On a genuine deadlock or a hard violation over a risk threshold or low reviewer confidence, reconcile escalates: `lookupPeers` to find the human, `addParticipant`, then `sendMessage` with an @mention to force a human decision.
5. The human decision is logged and folds back into the rulebook.
6. Enhancement: on "adapt", remediation rewrites the copy per region, regenerates a localized visual via Nano Banana, and re-submits (closes the bidirectional loop).

## 9. Band seam (band.ai account exists, but no agents until you create them)
A `BandTransport` interface with two implementations:
- `RealBandTransport`: wraps `@band-ai/sdk` (GenericAdapter, tools, run).
- `FakeBandTransport`: an in-process room bus (messages, mentions, events, participants, context) so all agents run in one Node process and the full debate is testable and watchable locally before keys are wired.

Honesty caveat this design honors: the fake is a dev/test harness only. The hackathon requires Band to be the real collaboration layer (it bans thin-wrapper usage), so the submission and demo video run on real Band. The fake never substitutes for that; it makes the reasoning/negotiation logic deterministically testable and the demo dev loop fast.

In both modes, agents can run as multiple `Agent.create().run()` instances in one process (each with its own prefix credentials in real mode), so `pnpm dev` spins up the whole board.

## 10. Project structure
```
src/
  band/        transport.ts (interface), real.ts (@band-ai/sdk), fake.ts (in-proc bus)
  models/      client.ts (ModelClient), aiml.ts, bedrock.ts, gemini.ts, route.ts (role->model map + MODEL_MODE)
  domain/      brandDna.ts, rulebook.ts, asset.ts, findings.ts (Finding/Verdict/Severity schemas)
  agents/      coordinator.ts, region-reviewer.ts (param by region+rulebook), brand-reviewer.ts, reconcile.ts, remediation.ts
  run/         local.ts (fake transport, all agents one process), agents.ts (real Band)
assets/        brand-dna.json, rulebook.us.json, rulebook.eu.json, sample-asset.json
docs/          AIML_SWITCHOVER.md, superpowers/specs/...
tasks/         todo.md, lessons.md
```

## 11. Build ladder (walking skeleton; rungs 1 to 5 are the MVP)
1. One agent in a Band room: connect a single agent, it posts and replies to an @mention. Done when plumbing works (prove against fake first, then real once agents are created).
2. Two-agent handoff: coordinator @mentions a reviewer; the reviewer replies through Band.
3. One real region reviewer on the sample asset: produces structured findings (issues, severity, rationale) against its rulebook.
4. Full review board: add the second region reviewer plus brand reviewer plus reconcile; the reviewers post findings and reconcile detects the cross-region conflict and issues per-region verdicts.
5. Human gate (MVP): on deadlock or high-risk, reconcile escalates to the human, whose decision is recorded and folded into the rulebook.

Enhancements after rung 5, in priority order: remediation plus Nano Banana (AIML showcase, multimodal moment, bidirectional loop); a third region (dynamic recruitment); a cross-framework reviewer via the TS `LangGraphAdapter`; a Featherless open-model reviewer (Featherless prize).

## 12. Testing
Fake transport plus a stubbed `ModelClient` returning canned structured outputs gives deterministic, free integration tests: assert all reviewers post findings, a conflict is detected on the claim span, reconcile issues per-region verdicts, and the deadlock case escalates. Separate live smoke tests exercise AIML chat, Nano Banana, Bedrock, and Gemini. Never mark a rung complete without running it and showing output.

## 13. Demo
The Band room in app.band.ai is the demo surface; no custom UI is required for the MVP. One continuous real run, 2 to 3 minutes, hook in the first 10 seconds, showing US approve, EU veto, reconcile per-region verdicts, escalation, human ruling, and the remediation EU variant. Do not over-edit.

## 14. Open items (needed at the relevant rung)
- Create the agents in app.band.ai (UUIDs plus keys), drop creds into `.env` (gitignored). Agent list: Coordinator (created), US reviewer, EU reviewer, Brand reviewer, Reconcile, Remediation.
- An AIML API key for the showcase and Nano Banana calls (dev runs on AWS/GCP).
- Confirm with organizers: which Band adapters are live; AIML prize "meaningful use" mechanics; the exact deadline (lablab times convert to about 9 AM CST Jun 19, vs 10 AM CST in CLAUDE.md).
