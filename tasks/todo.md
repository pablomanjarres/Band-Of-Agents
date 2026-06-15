# Todo: Multi-Region Marketing Compliance Review Board

Plan derived from `docs/superpowers/specs/2026-06-13-multi-region-review-board-design.md`.
Walking skeleton: prove each rung end to end (run it, show output) before the next.
Platform: band.ai. Stack: TypeScript, Node 22+, pnpm, ESM. No commits/remote (per user).

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

# 2026-06-15: Campaigns + cascading dossier + multimodal review

Spec: `docs/superpowers/specs/2026-06-15-campaigns-multimodal-design.md`. Branch: `campaigns-multimodal`.
Baseline before work: tsc clean, 19/19 vitest pass. Keep both transports (local + band) working.
Keep it NON-LINEAR: reconcile fires per material, rollup is observational (the one rule).

## Rung A: campaign model + per-material board + dossier cascade + UI + cleanup
- [x] Domain types: add `Campaign`, `Material` (kind + video + perception + attachments),
      `CampaignDossier`, `MaterialPerception`; add `materialId` to `ReviewResult`/`RegionVerdict`. (Core1)
- [x] Persistence: `data/campaigns.json` library; legacy single asset reads as a one-material
      campaign; events carry `campaignId`/`materialId`. (Core1)
- [x] Board: keyed per material `${roomId}::${materialId}` (drives reconcile/reviewer per material
      with no decision-logic change); `board.dossier()`, `board.materialId()`. `startReReview` stays
      per key. (Core1) The band-mode `nextMaterial` cursor is for the band coordinator path (later).
- [x] Reconcile: per-material trigger (per-key gate, never campaign-wide); observational worst-case
      rollup + material x region matrix in `src/board/campaign.ts` (computeRollup). (Core1+Core2)
- [ ] Coordinator: recruit once, post each material as a follow-up task; reviewers pull current
      material from the cursor (works in BOARD_MODE=band, the product path).
- [x] Reviewer prompt: cascade the dossier (approved claims, substantiation, approved info, source
      excerpts) + material perception into every region review via `buildReviewPrompt`. (Core1)
- [x] Server: `GET/POST /api/campaigns`, `GET /api/campaigns/:id`, `POST /api/campaigns/:id/materials`;
      `POST /api/reviews` accepts a campaignId or inline campaign (runs concurrently); SSE carries ids;
      `GET /api/campaign-reviews/:id` returns the rollup/matrix; `/decision` per material. Band mode
      intact. (Core2)
- [x] Web: `/campaigns` list + `/campaigns/:id` detail (dossier editor, nested materials tree,
      material x region matrix, drill into per-material Live Board).
- [x] Remove the fictional demo brand across code, tests, and sample data (replaced with the
      generic placeholder "Northwind Wellness" / product "Immune+"); tests stay green. Added
      a seed campaign (`data/campaigns.json`, `assets/sample-campaign.json`).
- [x] Tests: campaign load/validate; two materials negotiate without a shared gate (gated-concurrency
      proof); dossier present in prompt via the campaign run; reconcile per-material; worst-case rollup
      correctness; 3-material campaign run. (Core1: campaigns-core, Core2: campaigns-orchestration; 38
      tests green, tsc clean.) The over-SSE end-to-end run needs model creds; proven via `npm run local`.

## Rung A review
- 2026-06-15: Rung A GREEN and committed (ab4da28 engine, 174188b assets, bccd69a web). tsc clean,
  39/39 vitest (was 19). `npm run local` runs the 3-material "Immune+ Q3 Launch" campaign end to end
  on the fake transport: all 3 intakes fire before any verdict (concurrent, not a pipeline), the
  dossier cascade drives US-publish vs EU-disclosure divergence, hero-video remediates, promo-banner
  escalates to a human, and the rollup is observational (worst-case + 3x4 matrix). Web build green
  (tsc + vite, 57 modules). Verified directly, not just via the workflow. Remaining for full Rung A:
  the band-mode multi-material coordinator (the local/UI path is done via CampaignSession).

## Rung B: rulebook smart import + presets
- [x] `POST /api/rulebooks/:region/import` (json direct; md/text via LLM -> `Rule[]`, returned for
      confirmation, not auto-saved). Parser in `src/domain/rulebook-import.ts` (injectable
      ModelClient, stubbable). json validates directly (full Rulebook or bare Rule[], re-tagged to
      the target region); md/text goes through the AIML-default model (`modelFor('eu')`, honors
      MODEL_MODE) and normalizes ids/severity/region; returns a PROPOSAL, never persists.
- [x] Curated presets under `assets/presets/rulebook.{us-ftc,eu-health,latam}.json`;
      `GET /api/rulebooks/presets` (loader in `src/domain/presets.ts`, reads/validates from disk).
- [x] Web: Rulebooks page dropzone (.md/.json) + preset picker + editable preview table; manual
      edit stays. (Frontend; backend endpoints above are ready for it.)
- [x] Tests: `test/rulebook-import.test.ts` (9 tests): json import validates (full + bare Rule[]),
      md/text via a STUBBED ModelClient returns parsed Rules, presets load + each validates against
      the Rulebook schema. Backend verified end to end via curl against a live local server.

## Rung B review
- 2026-06-15: Rung B GREEN and committed. tsc clean, 48/48 vitest (+9). POST /api/rulebooks/:region/import
  returns a PROPOSAL only (json validated directly; .md/text parsed by the AIML-default model into Rule[],
  stubbable in tests); GET /api/rulebooks/presets serves 3 curated presets (us-ftc, eu-health, latam).
  Rulebooks page now has a dropzone (.md/.json), a preset picker, and an editable preview table (manual
  add/edit preserved); nothing persists until Save (PUT). Backend curl-verified live; web build green.

## Rung C: multimodal perception + live "analyzing" UI
- [ ] `Msg.content` becomes `string | ContentBlock[]`; update all four adapters (text passthrough
      unchanged); adapter tests.
- [ ] Perception pass: ffmpeg keyframes (host via Store), AIML vision (description/OCR/claims),
      AIML Whisper STT (transcript); attach `MaterialPerception`; cascade text + frames to
      vision-capable region models. Add `perception-vision`/`perception-stt` roles (AIML default,
      `MODEL_MODE` fallback, documented in AIML_SWITCHOVER.md).
- [ ] Video upload endpoint (`data/videos/`); frames under `data/images/`.
- [ ] SSE `perceiving` events; web side panel: cycling keyframe thumbnail + progress + transcript
      typing in + per-region "watching" badge, campaign matrix stays visible.
- [ ] Fallback: paste-transcript + skip-vision so a material always reviews if perception is down.
- [ ] Tests: perception artifacts cascade into the prompt; content-block adapter shapes.

## Documentation (required, per the user)
- [ ] `docs/CAMPAIGNS.md`: what was built and how it works (model, cascade, perception, import,
      non-linear negotiation, how to run).
- [ ] Update `README.md`: campaign + multimodal flow; AIML multi-model + three-modalities visible.
- [ ] Update this `tasks/todo.md` as items complete; add a Review section at the end.
- [ ] Append new correction patterns to `tasks/lessons.md`.

## Verification gates
- [ ] tsc clean + all tests green after each rung.
- [ ] A real local end-to-end run shown (not just unit tests) before claiming a rung done.
- [ ] Confirm the campaign negotiates per material concurrently (diff vs. baseline single-asset).
