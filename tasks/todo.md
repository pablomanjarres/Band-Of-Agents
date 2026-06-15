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
- [x] `Msg.content` becomes `string | ContentBlock[]`; update all four adapters (text passthrough
      unchanged); adapter tests. (Seam slice; test/model-content-blocks.test.ts, 14 tests.)
- [x] Perception pass (`src/perception/perceive.ts`, `perceiveMaterial`): ffmpeg keyframes (spawn,
      hosted via Store) -> seeded frames -> single image -> []; vision (one content-block call ->
      description/OCR/claims); STT (transcript) -> pasted transcript fallback; attach
      `MaterialPerception`; cascade text into every reviewer prompt (Rung A cascade) and frames to
      the vision call. Added `perception-vision`/`perception-stt` roles (AIML default, env-overridable
      `AIML_VISION_MODEL`/`AIML_STT_MODEL`, `MODEL_MODE` fallback, documented in AIML_SWITCHOVER.md).
      Wired BEFORE the region reviewers per material via BoardSession/CampaignSession, concurrent (no
      campaign serialization).
- [x] Video upload endpoint (`POST /api/videos`, multipart -> `data/videos/`, optional attach to a
      material) + `GET /api/videos/:name`; extracted frames hosted under `data/images/`. Server-side
      perception streams `perceiving` over the existing SSE.
- [x] SSE `perceiving` events (`src/board/events.ts` + web types/reducer): frameUrl + index/total +
      stage (vision|stt|done), tagged with campaignId/materialId; web `boardState` tracks a live
      `perceiving` snapshot (frame, progress, stage, transcript) per material lane; Timeline renders it.
- [x] Fallback: graceful at EVERY step (no ffmpeg, no vision, no STT, no AIML key) so a material
      always still reviews; key-free local server falls back to stub vision/STT + stub reviewers so
      the UI animates exactly like `npm run local`.
- [x] Tests: `test/perception.test.ts` (6) perception artifacts cascade into the prompt + the
      no-ffmpeg/no-model fallback returns a usable result and the material still reviews;
      `test/route.test.ts` (+3) perception routing (AIML defaults, env override, dev keeps STT on AIML);
      content-block adapter shapes (seam). 71 tests green, tsc clean, web build green.

## Documentation (required, per the user)
- [x] `docs/CAMPAIGNS.md`: what was built and how it works (model, cascade, perception, import,
      non-linear negotiation, how to run).
- [x] Update `README.md`: campaign + multimodal flow; AIML multi-model + three-modalities visible.
- [x] Update this `tasks/todo.md` as items complete; add a Review section at the end.
- [x] Append new correction patterns to `tasks/lessons.md`.

## Verification gates
- [x] tsc clean + all tests green after each rung.
- [x] A real local end-to-end run shown (not just unit tests) before claiming a rung done.
- [x] Confirm the campaign negotiates per material concurrently (diff vs. baseline single-asset).

## Rung C review
- 2026-06-15: Rung C GREEN and committed (d6b0c75 seam, 3bd1eab perception, ce9604f seed+docs, 92356ab web).
  tsc clean, 71/71 vitest. Msg.content is string|ContentBlock[] across all four adapters (string path
  byte-identical). Perception pre-pass (AIML vision + Whisper STT) runs per material before the reviewers with
  graceful fallback (no ffmpeg/key never crashes); artifacts cascade via the Rung A prompt path. `npm run local`
  shows hero-video perceiving [vision] 1/4..4/4 -> [stt] -> [done], all materials concurrent, rollup correct.
  Live PerceptionPanel cycles the keyframe while the matrix stays visible.

## Final review (Rungs A + B + C)
- 2026-06-15: All three rungs done, verified directly, committed on branch campaigns-multimodal (not pushed).
  19 -> 71 tests, tsc clean, web build green. Campaigns (nested materials) negotiated concurrently per material
  with an observational rollup (the one rule holds), a cascading dossier grounding every reviewer, smart rulebook
  import + presets, and real multimodal perception with a live analyzing panel. Demo brand removed. Docs:
  docs/CAMPAIGNS.md + updated README. Follow-ups: band-mode multi-material coordinator (local/server campaign
  path is done); confirm the real AIML vision/STT slugs (env-overridable).

## 2026-06-15 (rev 2): Advertisement tier + UI redesign (user feedback)

Confirmed: Campaign (product) -> Advertisements -> Materials (videos/posts/images per ad).
Layout: 2-pane + slide-over (left = live video processing; main = ad tabs + materials grid;
click material -> right slide-over detail). Fix uploads (md/json/image/video, real), add-anytime,
drop legacy Compose, material click shows the material (not the agent diagram).

### Rung D: Advertisement tier + orchestration + uploads + server + seed
- [x] Domain: add Advertisement; Campaign.advertisements[] (replaces flat materials[]); drop Material.attachments;
      advertisementId on ReviewResult/RegionVerdict; normalizeCampaign() back-compat (legacy materials[] -> single
      "Default" advertisement), wired as the Campaign schema preprocess + exported.
- [x] Orchestration: CampaignSession iterates ads -> materials, EVERY material concurrent (Promise.all over all
      materials across all ads) under board key `${roomId}::${adId}::${materialId}`; reconcile stays per material;
      rollup per advertisement (worst-case per region + that ad's matrix) AND per campaign; matrix cells carry
      advertisementId. The one rule holds: no ad-wide or campaign-wide gate.
- [x] Persistence/seed: re-seeded assets/sample-campaign.json + data/campaigns.json as 3 advertisements (Hero Launch,
      Retargeting, Influencer) reusing the creatives; legacy materials[] loads as a single "Default" advertisement,
      and the store normalizes stored campaigns on read (safeNormalize) so old data/campaigns.json still loads.
- [x] Server: advertisements + materials CRUD (POST /api/campaigns/:id/advertisements, /materials targets an ad,
      add-anytime); image upload (POST /api/images); dossier-source upload (POST /api/campaigns/:id/dossier-sources);
      video upload attaches across ads; SSE carries adId+materialId; list returns advertisementCount + materialCount.
- [x] Server (TASK-spec paths + tests): added POST /api/campaigns/:id/advertisements/:adId/materials (ad addressed in
      the URL; 404 on an unknown adId) and POST /api/campaigns/:id/dossier/sources (multipart file OR JSON body
      {name,kind,content}); the prior /materials (adId in body) and /dossier-sources (multipart) kept as aliases.
      advertisements/materials add-anytime (no status gate, incl. after a completed review). Made the Hono app
      import-safe (lazy bandBoard, main() runs only as the entrypoint) and exported { app, store } so HTTP tests drive
      it via app.fetch with no port bound. New test/server-campaigns.test.ts (18 tests): ad/material CRUD via both
      paths (incl. add-after-completed-review), image upload (+attach), dossier sources (file + JSON), list/detail
      counts, and a campaign review whose SSE events all carry advertisementId+materialId with the per-ad + campaign
      computeRollup. 89/89 vitest, tsc clean; live-verified over HTTP on a free port.
- [x] demo-fixtures: keyed by stable material ids (hero-video, launch-post, promo-banner, ...); unknown ids default
      to NO findings so the new materials never crash; the US=escalate (banner) / EU+LATAM=adapt (hero-video) conflict
      is kept.
- [x] Tests green (3-tier load/validate; legacy-normalize; concurrency across DIFFERENT ads with no shared gate;
      per-ad + per-campaign rollup correctness). tsc clean, 71/71 vitest; `npm run local` shows 7 materials across
      3 ads negotiated concurrently with a correct per-ad + campaign rollup.

### Rung D review
- 2026-06-15: Rung D GREEN. Three tiers (Campaign -> Advertisement -> Material). normalizeCampaign() gives full
  back-compat (legacy flat materials[] -> a single "Default" advertisement) and is the Campaign schema's preprocess,
  so old data, old seeds, and old tests load. CampaignSession runs every material across every advertisement
  concurrently under `${roomId}::${adId}::${materialId}`; reconcile fires per material (the one rule); computeRollup
  returns worstCaseByRegion + perAdvertisement[{advertisementId,name,worstCaseByRegion,matrix}] + a campaign-wide
  matrix whose cells carry advertisementId. Seed re-grouped into Hero Launch / Retargeting / Influencer (7 materials).
  Server gained advertisement + material CRUD, image upload, and dossier-source upload. tsc clean, 71/71 vitest,
  `npm run local` verified. NOT done here (Rung E): the campaign-detail web UI still uses its own flat-materials
  types; it must adopt advertisements (tabs + slide-over) and wire the new uploads.

### Rung E: campaign-detail UI redesign (2-pane + slide-over)
- [x] Full-width 2-pane layout; left rail = live perception (analyzing video) during review.
- [x] Main: advertisement tabs/pagination + selected ad's materials grid; prominent dropzones.
- [x] Click material -> right slide-over detail (media, copy, claim, perception, per-region verdicts, "View debate").
- [x] Real uploads wired (video/image for materials, .md/.json for rulebooks + dossier sources).
- [x] Add advertisements/materials anytime (incl. after completion).
- [x] Drop legacy Compose from nav; campaign-first nav. web build green.

## Rung D + E review (advertisement tier + UI redesign)
- 2026-06-15: 3-tier model (Campaign -> Advertisement -> Material) shipped and committed (ea6508c backend, 18316b3 web). Backend 89/89 tests, tsc clean; web build green. Redesign: campaign-first nav (Compose removed), full-width 2-pane workspace (LEFT = live video-processing rail, MAIN = advertisement tabs + materials grid), clicking a material opens a slide-over of THE MATERIAL (media preview, copy, claim, perception, per-region verdicts) with "View debate" for the agent diagram, real drag-and-drop uploads (video/image for materials, .md/.json/.txt for dossier sources), add advertisements/materials anytime, New campaign creator. Live-verified on localhost:8791: campaigns API returns 3 ads / 7 materials; a campaign review runs concurrently with perceiving frames + a correct per-advertisement rollup (Retargeting = US escalate from the banner). Pushed; Vercel frontend deploy re-runs green.
