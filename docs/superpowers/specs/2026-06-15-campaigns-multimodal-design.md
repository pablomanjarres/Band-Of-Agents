# Campaigns, Cascading Dossier, and Multimodal Review: Design

Date: 2026-06-15
Status: approved (brainstorm complete), implementation pending
Branch: `campaigns-multimodal` (worktree off `worktree-band-review-board`)
Supersedes nothing. Extends `2026-06-13-multi-region-review-board-design.md`.

## 1. Problem

Today a review covers exactly one `ContentAsset`, and model calls are text only. The
asset is serialized to JSON and sent as a string (`src/agents/region-reviewer.ts:123`),
so the real image is never sent to any model and there is no video or transcript anywhere.
Rulebooks are entered one rule at a time with no import and no presets.

A real product launch is a campaign: one product with many marketing materials (videos,
posts, images, banners), where a video can own its derived posts and images. The materials
share a single source of truth (approved claims, substantiation, regulatory facts) that must
ground every reviewer. We need:

1. A campaign model: product = campaign, holding many materials with one level of nesting.
2. A campaign dossier that cascades shared context down to every material's review.
3. Multimodal perception: agents actually see images and video, and hear video audio
   (transcript), with a live "analyzing" visualization in the UI.
4. Rulebook smart import (.md via LLM, .json direct) plus one-click presets.
5. Removal of the "Lumavida" demo brand (the project is a system, not a product).

## 2. The one rule (non-negotiable constraint)

This is not a linear pipeline. The originality is the conflict: reviewers with competing
regional mandates disagree on the same material and reconcile a per-region verdict. Moving to
many materials must NOT serialize into material-1 then material-2 then material-3. See section 7.

Per `tasks/lessons.md`: the review happens INSIDE a real band.ai room (BOARD_MODE=band is the
product path); the web app is a portal and observer, not the orchestrator. AIML is the default
model route (`MODEL_MODE`), with cost-savers (Bedrock, Vertex) behind one switch. Model ids are
constrained to the set already in `src/models/route.ts` (no Opus 4.8).

## 3. Goals and non-goals

Goals:
- Review a campaign of many materials, each negotiated per region, concurrently.
- Cascade a campaign dossier into every reviewer prompt.
- Real vision (images and sampled video keyframes) and real transcript (STT) feeding reviews.
- Live UI: a side panel that cycles the video keyframe being analyzed while the campaign matrix
  stays visible.
- Rulebook smart import plus presets; replace the one-by-one editor pain.
- Keep BOTH transports working: local (test substrate) and band (product path).

Non-goals (for this build):
- Arbitrary-depth material trees (one level of attachments is the floor and the ceiling).
- Cross-material negotiation as a new debate (cross-material divergence is surfaced as an
  observation in the rollup, not a new agent round).
- Timeline-anchored findings (mapping a finding to a video timestamp) is a later nicety.

## 4. Data model

Extends `src/domain/types.ts`. `Material` reuses every `ContentAsset` field verbatim and adds a
discriminating `kind` plus video and perception fields. `Campaign` is the new top-level unit.

```ts
// New: shared source-of-truth that cascades to every material.
CampaignDossier {
  approvedClaims: string[];   // claims pre-cleared, each with backing
  substantiation: string;     // trials, data on file, medical/regulatory facts
  approvedInfo: string;       // approved messaging and mandatory info
  sources: { name: string; kind: 'md' | 'json' | 'text'; content: string }[];
}

// Perception artifacts produced by the pre-pass (section 6). All text, so they cascade
// like the dossier and every region (even a text-only model) benefits.
MaterialPerception {
  transcript?: string;        // STT of the video audio
  onScreenText?: string;      // OCR of sampled frames
  visualDescription?: string; // what the frames depict
  detectedClaims?: string[];  // claims the perception model read off the material
  frames: string[];           // hosted keyframe URLs (vision input + live UI)
}

Material = ContentAsset & {
  kind: 'video' | 'post' | 'image' | 'banner';
  videoUrl?: string;
  perception?: MaterialPerception;
  attachments?: Material[];   // a video owns its posts/images (one level only)
}

Campaign {
  id: string;
  name: string;               // the product, e.g. "Aurial Q3"
  markets: string[];          // default markets; a material may narrow
  dossier: CampaignDossier;
  materials: Material[];
}
```

`ReviewResult` and `RegionVerdict` gain `materialId: string` so findings and verdicts tie to a
specific material. `Finding` is unchanged.

Persistence: `data/campaigns.json` stores `Campaign[]` (the saved library, replacing the
single-asset `data/assets.json` role; assets.json kept for back-compat read). A stored review
(`data/reviews.json`) records `campaignId`, `materialId` on each event so the UI can rebuild a
per-material timeline.

## 5. The cascade (dossier + perception, one mechanism)

Every region reviewer's user prompt is assembled from four parts, in this order:
1. Region rulebook (already loaded live from the store).
2. Brand DNA (already loaded).
3. Campaign dossier (new): approved claims, substantiation, approved info, source excerpts.
4. The material under review: copy, claim, channel, plus perception artifacts (transcript,
   on-screen text, visual description) and, for vision-capable region models, the raw frames.

Effect: a claim like "clinically proven" is judged against the dossier's substantiation. If the
dossier backs it, US can publish while EU still demands a disclosure. Editing the dossier once
re-grounds every material. This reuses the existing precedent-injection pattern in the reviewer
prompt builder, so it is one concept, not a new subsystem.

Implementation seam: `buildReviewPrompt` in `src/agents/region-reviewer.ts:97-125` takes the
dossier and the material's perception and serializes them into the prompt. The board exposes the
dossier via `board.dossier(roomId, campaignId)`.

## 6. Multimodal perception pre-pass

Rather than force all four model adapters to do vision (one region runs Llama 3.1 8B, text only),
a perception pass runs once per visual or video material, before the regional reviewers:

1. Extract keyframes from the video (ffmpeg, N frames evenly spaced) and host them via the
   existing `Store.hostImage` path (`src/store/store.ts:53-65`). For an image material, the single
   image is the only "frame".
2. Vision: send the frames to a vision-capable model on AIML, producing `visualDescription`,
   `onScreenText` (OCR), and `detectedClaims`.
3. Audio: send the video audio to a Whisper-class STT on AIML, producing `transcript`.
4. Attach the `MaterialPerception` to the material and cascade it as text to all reviewers.
   Vision-capable region models (Gemini, Claude, GPT class via AIML) additionally receive the raw
   frames for fidelity; text-only models get the description.

AIML is the route for both vision and STT (the "three modalities" prize signal: text, image,
audio). Exact AIML model slugs for vision and STT are confirmed at implementation time against the
AIML catalog and added to `route.ts` behind `MODEL_MODE` with a documented fallback in
`docs/AIML_SWITCHOVER.md`.

Model seam change: `Msg.content` becomes `string | ContentBlock[]` where
`ContentBlock = { type: 'text'; text: string } | { type: 'image'; url: string }`. Each adapter
maps blocks to its provider format; a plain string stays a plain string (no behavior change for
existing text calls). This is additive and keeps the 19 existing tests green.

### Live "analyzing" UI

During the perception pass the server emits `perceiving` SSE events:
`{ campaignId, materialId, frameUrl, index, total, stage: 'vision' | 'stt' | 'done' }`.
The campaign detail page shows a side panel beside the matrix: the current keyframe thumbnail
(cycling as `index` advances), a progress bar, the transcript typing in as it returns, and a
"watching" badge per region. The thumbnail changing every moment is the actual frames being read.
The main campaign view (matrix + materials) stays visible throughout.

## 7. Keeping it non-linear

- Board partitions state by `(campaignId, materialId)` instead of one room = one asset
  (`src/board/shared.ts:11-16`).
- Reconcile fires per material when that material's expected regions are all in, never a
  campaign-wide gate (the bottleneck risk is `expectedRegions.every(has)` at
  `src/agents/reconcile.ts:74`; it becomes per-material).
- Remediation reopens only the one material (`startReReview` scoped to a materialId), so
  material-1 can be in remediation round 2 while material-3 is still in first review.
- Campaign rollup is an observational read over per-material verdicts: worst-case per region for
  the badge, plus the full material x region matrix. It blocks nothing.
- band.ai coordination (BOARD_MODE=band): the Coordinator recruits reviewers once, then posts each
  material as a follow-up task and the reviewers pull the current material from a board cursor
  (`board.nextMaterial(campaignId)`), preserving dynamic recruitment
  (`src/agents/coordinator.ts:52-76`). One room per campaign; materials are concurrent tasks in it.

## 8. Rulebook smart import and presets

- `POST /api/rulebooks/:region/import` accepts a body `{ format: 'md' | 'json' | 'text', content }`.
  `json` validates against the `Rulebook`/`Rule` schema directly. `md`/`text` goes through an LLM
  that emits structured `Rule[]` (zod-validated structured output), returned for confirmation
  before save (not auto-persisted).
- Presets: curated rulebooks under `assets/presets/rulebook.<preset>.json` (US-FTC, EU health
  claims, LATAM) and `GET /api/rulebooks/presets` to list them, applied with one PUT.
- UI: the Rulebooks page gets a dropzone (.md/.json), a preset picker, and an editable preview
  table, replacing the row-by-row entry as the primary path. Manual editing stays available.

## 9. Web UI surface

- `web/src/App.tsx`: add `/campaigns` and `/campaigns/:id` routes and nav.
- `web/src/types.ts`: add `Campaign`, `Material`, `CampaignDossier`, `MaterialPerception`,
  `materialId` on review/verdict events, a `perceiving` event, and `CampaignSummary`.
- `web/src/boardState.ts`: hold `materials[]` with per-material region maps; derive the aggregate
  campaign verdict (worst-case per region).
- `/campaigns` list page: cards (name, material count, aggregate verdict badge).
- `/campaigns/:id` detail page: dossier editor panel, nested materials tree with an add-material
  form (including video upload and kind), the material x region matrix (cell = verdict + finding
  count, click drills into the existing Live Board pipeline for that material), and the live
  "analyzing" side panel.
- Reuse `PipelineDiagram` per material rather than building a new debate view.

## 10. Server and API additions

- `GET /api/campaigns`, `GET /api/campaigns/:id`, `POST /api/campaigns` (save/update),
  `POST /api/campaigns/:id/materials` (add material, multipart for video).
- `POST /api/reviews` (local mode) accepts a `campaignId` (or inline campaign) instead of a single
  asset; band mode continues to start in app.band.ai with "Coordinator, review campaign <name>".
- SSE events gain `campaignId`/`materialId`; new `perceiving` event type.
- `POST /api/rulebooks/:region/import`, `GET /api/rulebooks/presets` (section 8).
- Video upload endpoint hosts the file under `data/videos/` and frames under `data/images/`.

## 11. Model routing

Reuse `src/models/route.ts` per-role routing. Add two perception roles, AIML-default:
- `perception-vision`: a vision-capable AIML model (slug confirmed at build).
- `perception-stt`: a Whisper-class AIML model (slug confirmed at build).
Both honor `MODEL_MODE` with documented non-AIML fallbacks. No Opus 4.8; stay within the existing
constrained set for the reviewer roles.

## 12. Persistence and back-compat

- `data/campaigns.json` for the saved library. A single legacy `ContentAsset` is read as a
  one-material campaign so existing `data/assets.json` and reviews still load.
- Stored reviews keep their event stream; events gain `campaignId`/`materialId` (optional on old
  records).

## 13. Testing strategy

- Keep all 19 existing tests green (additive seam changes only).
- New unit tests: campaign load/validate; per-material board partition (two materials negotiate
  without a shared gate); dossier cascade present in the reviewer prompt; reconcile fires per
  material; rulebook import (json direct + md-to-rules via a stubbed model); perception artifacts
  cascade into the prompt; `Msg` content-block adapters (text passthrough unchanged, image block
  shape per provider with stubbed clients).
- One end-to-end local run: a 3-material campaign with a dossier, asserting concurrent per-material
  verdicts and a correct worst-case rollup, over SSE.
- TDD where it pays: write the failing test for each new board/reconcile behavior first.

## 14. Build order (walking-skeleton rungs)

Each rung is proven green (tests + a real run) before the next.

- Rung A: Campaign model + per-material board partition + dossier cascade (text) + campaign UI
  (list, detail, matrix) + Lumavida cleanup. End to end on text materials, both transports.
- Rung B: Rulebook smart import (.md/.json) + presets, endpoint + UI.
- Rung C: Multimodal perception (AIML vision + STT) + `Msg` content blocks + live "analyzing"
  panel + frames to vision-capable regions. Resumes the paused vision-review item.

## 15. Documentation deliverables (required)

- This spec (design of record).
- `tasks/todo.md`: the checkable plan, kept current, with a Review section on completion.
- `docs/CAMPAIGNS.md`: what was built and how it works (campaign model, dossier cascade,
  perception pass, rulebook import, the non-linear per-material negotiation, how to run).
- `README.md`: update the flow to campaigns + multimodal and make the AIML multi-model and
  three-modalities routing visible (also clears a submission-backlog item).
- `tasks/lessons.md`: append any new correction patterns.

## 16. Risks

- Linearizing the campaign would kill the originality thesis. Mitigation: per-material reconcile
  trigger and an observational rollup (section 7); a test asserts concurrent per-material progress.
- `Msg` seam change touches all four adapters and could destabilize the verified text demo.
  Mitigation: additive union (string stays string), adapter tests, and perception lands last
  (Rung C) so the text product stays shippable throughout.
- AIML vision/STT slug or quota surprises. Mitigation: confirm slugs early, keep a paste-transcript
  and skip-vision fallback so a material always reviews even if perception is unavailable.
