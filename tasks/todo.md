# Todo: Multi-Region Marketing Compliance Review Board

Plan derived from `docs/superpowers/specs/2026-06-13-multi-region-review-board-design.md`.
Walking skeleton: prove each rung end to end (run it, show output) before the next.
Platform: band.ai. Stack: TypeScript, Node 22+, pnpm, ESM. No commits/remote (per user).

## Orchestration redesign (active): Blackboard pods on a decision spine
Full plan: `docs/superpowers/plans/2026-06-14-blackboard-pods-and-spine.md` (design: `docs/superpowers/specs/2026-06-14-orchestration-redesign-proposals.md`, Proposal 4). Replaces the scatter-gather (coordinator broadcast + deterministic reconcile) with pods that debate, a board that reconciles, and a spine that ends in a terminal state.
- [x] Phase 0: board domain schemas (work-items, pod findings, conflicts, adjudication).
- [x] Phase 1: knowledge-source shell, pod-lead, Regulatory debate (rebuttal round).
- [x] Phase 2: Claims and Brand pod members.
- [x] Phase 3: Mediator at the board.
- [x] Phase 4: Conductor + Risk Adjudicator (the decision spine).
- [x] Phase 5: routing, board events, full wiring, walking-skeleton integration, real Band.
- [x] Phase 6 (optional): web live-board diagram (pods + board + spine).

### Review (2026-06-14): blackboard pods/board/spine implemented on branch `blackboard-pods`
Implemented end to end via TDD, one commit per task (19 task commits, exact plan messages,
no co-author trailers, no em dashes). Built on a worktree branched off `orchestration-redesign`.
- Tests: 35 passing across 22 files (was 19/11). Root + web typecheck clean (noUncheckedIndexedAccess).
- `pnpm local` proves the full flow on the fake transport: intake to 3 pods, the Regulatory
  debate (Reg Lead challenges EU with the US peer rationale, EU holds), one conflict-bearing
  PodFinding, Adjudicator consults the Mediator (no movement), one remediation recommit, deadlock
  escalation to the human, terminal SPIKED. The conflict is genuine (verified), not a linear pipeline.
- Phase 5.6 wires the same cast on RealBandTransport (typechecked). Live `pnpm agents` is the only
  remaining manual step: needs 17 band.ai agents registered (handles in src/run/agents.ts) plus their
  PREFIX_AGENT_ID/PREFIX_API_KEY in `.env`. The web live-board visual (`pnpm --dir web dev`) is also
  a manual check; the diagram model (web/src/pipeline.ts) is a pure derivation and typechecks.
- Known MVP simplifications (carried from the plan, not regressions): Claims/Brand pod members run
  concurrently (the genuine debate is the Regulatory rebuttal round); the demo exercises the HOLD
  branch, the CONCEDE-downgrade branch exists in code but is not hit by the default run.

## Phase 0: Scaffolding -- DONE
- [x] pnpm + TypeScript ESM project (package.json, tsconfig, vitest, MIT LICENSE, README).
- [x] Domain types + zod schemas.
- [x] assets/: brand-dna.json, rulebook.us.json (6), rulebook.eu.json (7), rulebook.latam.json (illustrative), sample-asset.json (split claim).
- [x] ModelClient interface + StubModelClient.
- [x] BandTransport interface + FakeBandTransport + RealBandTransport.
- [x] .env.example.
- [x] Real model adapters: aiml.ts (openai SDK -> AIML + Nano Banana fetch), bedrock.ts, gemini.ts; route.ts (MODEL_MODE switch) with 429 retry.
- [x] docs/AIML_SWITCHOVER.md.

## MVP (rungs 1-5) -- DONE on the fake transport
- [x] Rung 1: agent replies only when @mentioned.
- [x] Rung 2: coordinator recruits + hands off; reviewer replies.
- [x] Rung 3: region reviewer produces structured findings on the asset.
- [x] Rung 4: full board; reconcile detects US-publish / EU-block conflict; per-region verdicts.
- [x] Rung 5: deadlock escalates to human; decision logged as precedent.
- [x] Full board incl. Brand reviewer (US/EU/Brand + Reconcile). `pnpm local` runs it. 10 tests green.

## Real integrations
- [x] Model layer (AIML main + Bedrock/Vertex dev), typechecked vs real SDKs.
- [x] RealBandTransport via @band-ai/sdk, typechecked.
- [x] Real runner `pnpm agents` wiring the 5 created agents (Coordinator/US/EU/Brand/Reconcile).
- [ ] LIVE RUN on band.ai. BLOCKED: API keys were truncated in the screenshots; need the full
      keys in .env, plus MODEL_MODE + AIML key (or AWS/GCP creds) for live model calls. Then
      smoke-test and capture the real-room transcript.
- [ ] LATAM region: drop-in once a band.ai LATAM agent exists (rulebook ready).

## Enhancements
- [ ] Remediation + Nano Banana: rewrite copy per region, regenerate localized image via AIML,
      re-submit (bidirectional loop). AIML prize + multimodal moment. (Next; buildable on fake.)
- [ ] Verify full-AIML mode end to end + smoke-test chat and Nano Banana.
- [ ] Cross-framework reviewer via TS LangGraphAdapter.
- [ ] Featherless open-model reviewer (Featherless prize).

## Final stretch
- [ ] Record the video (one continuous real run, hook in 10s, 2 to 3 min).
- [ ] Slides; clean public MIT repo with README + hosted demo URL.

## Review
- 2026-06-13: MVP (rungs 1-5) proven on the fake transport; the full debate (US/EU/Brand +
  Reconcile + human escalation + precedent) runs via `pnpm local`. Model layer (AIML main path +
  Bedrock/Vertex dev, one MODEL_MODE switch) and RealBandTransport both written and typechecked
  against the real SDKs. 10 vitest tests pass, `tsc --noEmit` clean. Blocked only on the full
  band.ai agent API keys for the live run.

---

# Review Board UI (compliance console)

Goal: a React + Tailwind console so a user submits an asset via a form (not JSON) and watches the
multi-region review stream live, including remediated copy + the Nano Banana image.

Approved: real band.ai room integration (built over the transport seam so it also runs in-process);
Full scope (form + live board + history/precedent + rulebook editor + asset library); clean console.

Architecture: Hono backend reuses src/ and runs a board "session" over the BandTransport seam.
BOARD_MODE=local (FakeBandTransport + real models, no extra creds) for an immediate demo;
BOARD_MODE=band (RealBandTransport + an Intake agent) for the live room. Activity bus: each agent
send/recv/event -> BoardActivity -> BoardEvent -> SSE per review.

## Tasks
- [x] BoardActivity hook on the transport seam (types + FakeBandTransport), additive
- [x] BoardEvent model + activity->event translator (src/board/events.ts)
- [x] Board session orchestrator (src/board/session.ts) over the seam, real or stub models
- [x] Hono server: POST /api/reviews, GET /api/reviews/:id/events (SSE), POST decision, history
- [x] web/ scaffold: New Review form + Live Board (region cards, timeline, remediation, escalation)
- [x] Verify vertical slice end to end (local mode, real models): real review + real Nano Banana image over SSE
- [x] File-backed store + history/precedent (+ image hosting so events stay small)
- [x] Rulebook viewer/editor (per-review reload so edits are live)
- [x] Saved asset library
- [x] band.ai room mode, part 1: opt-in Coordinator/Reconcile intake/proxy acceptance (tested)
- [x] band.ai room mode, part 2: Intake agent (REST createChat/addChatParticipant/createChatMessage)
      + BandBoard + server BOARD_MODE=band. LIVE-VERIFIED end to end in a real band.ai room.
- [x] close the adapt -> remediation -> re-review loop (capped); live-verified: EU adapt -> remediate
      -> re-review -> EU publish, all through band.ai.

## Diagram fix: status
- [x] band.ai is the integration layer (BOARD_MODE=band): the app creates a room via the Intake
      agent, the reviewer agents collaborate in band.ai, the app only observes + streams.
- [x] Remediation -> re-review loop closed (was one-shot).
- [x] precedent -> shared context loop: recent human rulings fed into the region reviewers' prompts.
- [~] render the live board AS the diagram (Coordinator/Reconcile/Remediation/Compliance-lead nodes). In progress.

## band.ai-app reframe (band.ai is the entry point; UI is the back-office)
- [x] Coordinator fetches a saved campaign by name (lookupCampaign) - the band.ai kickoff.
- [x] Region reviewers read the live rulebook from the store (UI edits apply to the next review).
- [x] BandBoard is an OBSERVER: connects the agents (no room creation, no Intake) and auto-discovers
      reviews from band.ai room activity; agents write verdicts (events) + precedents to the store.
- [x] Server: band mode disables POST /api/reviews (start in band.ai); wires store into the agents.
- [x] Verified: agents connect in observe mode (7 agents, waiting). Pushed (PR #1 merged to main).
- [~] UI: compose/save campaigns (with name), read-only audit board, band.ai-flow framing. In progress.
- [ ] Live end-to-end: post "Coordinator, review campaign <name>" in app.band.ai, watch it auto-appear.

## Paused
- [ ] Image vision-review (region agents review the campaign image, not just copy). Adapters read;
      paused for the band.ai-app reframe.

## Submission (rubric) backlog
- [ ] README section making AIML multi-model routing visible (AIML prize).
- [ ] Public MIT repo, hosted demo URL, slides, video.

## Review (UI)
- 2026-06-13: Full-scope compliance console working in LOCAL mode (in-process transport, real
  multi-model agents). Verified end to end over SSE: real US/EU/LATAM/BRAND review, EU adapt ->
  remediation -> real Nano Banana image (hosted), conflict + escalation, history/precedent/rulebook
  editor/asset library, persistence across restart. 16 vitest tests pass, tsc clean. The board uses
  the exact same agents as band.ai; only the message transport differs. Live-room mode (band.ai)
  is the remaining piece and needs one more agent created in app.band.ai.

---

# Feature gaps execution (2026-06-14, branch feature-gaps)

Source: `.private/FEATURE_GAPS_TODO.md` (derived from the BAND_FEATURE_USAGE audit).
Method: TDD per gap (write a failing test on the FakeBandTransport, then minimal code,
then green), granular commits, `tsc --noEmit` + `vitest run` green after each gap.
Baseline before any change: 19 tests pass, tsc clean.

Guardrail (from the punch list): depth over breadth. Land P1 first, reassess against the
demo, then P2. P3 is stretch only and must not risk the verified demo.

## P1 (do first: highest lift, smallest change) -- DONE
- [x] P1.1 Target-region recruitment: coordinator filters recruited reviewers by
      `asset.markets` (opt-in `regionHandles`); `addParticipant` pulls in a targeted region
      agent not yet in the room. Reconcile waits only for recruited regions (opt-in
      `marketRegions`) so a single-market asset does not hang. Wired into band mode.
      Tests: target-region.test.ts, target-region-reconcile.test.ts.
- [x] P1.2 Bind room to task: `createRoom(taskId)` forwards the asset id to `createChat`
      via the testable `buildIntakeControl` helper; intake-probe binds a task id. Live
      band.ai persistence of task_id remains a manual probe. Test: intake-task-binding.test.ts.

Reassess checkpoint (guardrail): 24 tests green, tsc clean. The verified demo is intact
(all original 19 tests pass; new behavior is opt-in and additive; local BoardSession demo
unchanged). Proceeding to P2.

## P2 (then reassess against the demo) -- DONE
- [x] P2.3 Emit `task`-typed events for per-region progress: region reviewers (and now the
      brand reviewer, for consistency) open and close their review on Band's `task` channel.
      `task` was already in the transport's allowed set, so no transport change. Tests:
      region-task-event.test.ts.
- [x] P2.4 Vision reviewer reads the campaign image (third AIML modality): optional `images`
      on the model request, AIML adapter sends OpenAI `image_url` parts, a standalone vision
      reviewer files an IMAGE-lane finding and reports to Reconcile. Kept out of the production
      board wiring on purpose (would force a vision model into BoardModels and break the suite);
      live wiring is the follow-up. Test: vision-reviewer.test.ts.

## P3 (stretch) -- DONE (greenlit by the user)
- [x] P3.5 Band-native shared context. The SDK 0.1.6 has no /workspace file API and its Memory
      tools are gated, so the shared context (brand DNA + rulebooks) is published into the room as
      a tagged message and rehydrated via the /context endpoint (getChatContext), not a local
      store. Added the pure, tested primitive (codec + latest-wins selector + makeBandSharedContext)
      and the live capability RealBandTransport.connectContext. Test: shared-context.test.ts.
      Wiring each reviewer to rehydrate from /context per review is the remaining live step.
- [x] P3.6 Cross-framework reviewer. The SDK ships framework adapters, so NO external dependency
      was needed: one reviewer runs on the SDK's OpenAI tool-calling adapter (a different
      FrameworkAdapter than the GenericAdapter the other agents use), routed through AIML via a
      custom client factory. Added buildCrossFrameworkAdapter + RealBandTransport.connectFrameworkAgent,
      wired opt-in into band mode (gated on XFRAMEWORK_AGENT_ID, default off). Test: cross-framework.test.ts.

## Review (feature gaps, 2026-06-14)
Shipped P1 + P2 on branch `feature-gaps`, branched from `worktree-band-review-board`, with strict
TDD (a failing test on the FakeBandTransport, then minimal code, then green) and granular commits.
Baseline was 19 tests; the suite is now 31 (12 new), with `tsc --noEmit` clean after every change.

Verified by two adversarial review workflows (P1/P2: 5 skeptics; P3: 3 skeptics): every gap
returned correct/doneWhenMet, no regression, conventions OK, and zero non-low issues. The original
19 tests all still pass, so the verified demo is intact; every new behavior is opt-in and additive.

What is proven on the fake-transport / unit proxy, and what remains for a live band.ai/AIML run:
- P1.1 targeting and dynamic addParticipant: proven at the coordinator and reconcile level.
  Live remains: confirm a dynamically added region agent actually joins and reviews in a real room.
- P1.2 task binding: forwarding of the asset id into `createChat(taskId)` is unit-proven; live
  remains: confirm band.ai persists the task_id (run `pnpm exec tsx src/run/intake-probe.ts`).
- P2.3 task events: proven the events carry `messageType: 'task'`; live remains: confirm they
  render under Band's task channel in app.band.ai.
- P2.4 vision: proven the reviewer is fed the image and files an image-level finding; live remains:
  a real AIML vision slug (e.g. `google/gemini-2.5-pro`) on an asset with a real imageUrl, and the
  optional production wiring (a vision agent + `IMAGE` in expectedRegions).
- P3.5 shared context: the publish/rehydrate primitive is unit-proven; live remains: wire reviewers
  to rehydrate from /context per review (needs room membership and a live room).
- P3.6 cross-framework: adapter construction and AIML routing are unit-proven; live remains: create
  a band.ai agent for the XFRAMEWORK prefix and confirm the OpenAI-framework reviewer coordinates
  in a real room.

P3 was greenlit by the user and is done. Both items were de-risked by mapping the actual
`@band-ai/sdk` 0.1.6 surface: there is no /workspace file API (so shared context uses the room plus
the /context endpoint, never the gated Memory tools), and the SDK already ships framework adapters
(so cross-framework needed no new dependency). The full suite is 31 green and tsc is clean.
