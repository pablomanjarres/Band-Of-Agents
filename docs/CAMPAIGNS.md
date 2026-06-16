# Campaigns, Cascading Dossier, and Multimodal Review

This document describes the campaign feature set added on 2026-06-15: reviewing a whole
product launch (many marketing materials) instead of a single asset, grounding every
reviewer in a shared campaign dossier, and letting the agents actually see video and
images and hear video audio (transcript) with a live "analyzing" view in the UI.

Design of record: `docs/superpowers/specs/2026-06-15-campaigns-multimodal-design.md`.
This file documents what was built and how to run it.

## The one rule it preserves

This is not a linear pipeline. The originality of the system is the conflict: regional
reviewers with competing mandates disagree on the same material and reconcile a per-region
verdict. Moving from one asset to a campaign of many materials does NOT serialize into
material-1 then material-2 then material-3. Each material is its own independent
negotiation, all running concurrently, and the campaign verdict is an observation over
them, never a gate.

## Data model

Defined in `src/domain/types.ts` (zod schemas double as runtime validators).

- `Campaign`: a product launch. `{ id, name, markets[], dossier, materials[] }`.
- `Material`: one deliverable. It reuses every `ContentAsset` field (copy, claim, markets,
  imageUrl, ...) and adds `kind` ('video' | 'post' | 'image' | 'banner'), optional
  `videoUrl`, optional `perception`, and one level of `attachments` (a video owns its
  derived posts and images). Nesting stops at one level by construction (no recursive schema).
- `CampaignDossier`: the shared source-of-truth that cascades to every material.
  `{ approvedClaims[], substantiation, approvedInfo, sources[] }`.
- `MaterialPerception`: artifacts from the multimodal pre-pass.
  `{ transcript?, onScreenText?, visualDescription?, detectedClaims?, frames[] }`. All text
  except `frames` (hosted keyframe URLs), so they cascade to every reviewer as context.
- `ReviewResult` and `RegionVerdict` carry an optional `materialId` so findings and
  verdicts tie to a specific material.

Persistence: a saved campaign library lives in `data/campaigns.json` (runtime, gitignored).
The durable, git-tracked demo seed is `assets/sample-campaign.json`; `Store.listCampaigns()`
falls back to it when the library is empty, so a fresh clone still has the demo campaign.

## How a campaign review runs

`src/board/campaign.ts` (`CampaignSession`) is the orchestrator for the local and server
paths. For each material it starts a `BoardSession` under the board key
`` `${roomId}::${materialId}` `` and runs them all with `Promise.all`, so every material
negotiates independently and in parallel. Per material:

1. Perception pre-pass (for video and image materials): see below. It attaches a
   `MaterialPerception` to the material and streams `perceiving` events.
2. Region reviewers (US, EU, LATAM, Brand) each review the material against their own
   rulebook, with the dossier and perception cascaded into the prompt (see "The cascade").
3. Reconcile decides a per-region verdict for that material as soon as that material's
   regions are all in. This is the existing per-key gate (`src/agents/reconcile.ts`), so it
   is per material, never campaign-wide.
4. Remediation reopens only that material if a region is fixable via disclosure; an
   unresolvable block escalates to a human.

After all materials reach a terminal state, `computeRollup` derives the observational
campaign rollup: the worst-case decision per region across materials (publish < adapt <
escalate) plus the full material x region matrix. The rollup blocks nothing.

`src/run/local.ts` demonstrates this end to end on the in-process fake transport with stub
models (no credentials needed): `npm run local` runs the 3-material "Immune+ Q3" campaign
concurrently; `npm run local single` runs the legacy single-asset path for comparison.

## The cascade (dossier + perception)

`buildReviewPrompt` in `src/agents/region-reviewer.ts` assembles each reviewer's prompt
from: the region rulebook, the brand DNA, the campaign dossier (approved claims,
substantiation, approved info, source excerpts), and the material under review including its
perception artifacts (transcript, on-screen text, visual description, detected claims).

Effect: a claim like "clinically proven" is judged against the dossier's substantiation. If
the dossier backs it, US can publish while EU still demands a disclosure. Editing the
dossier once re-grounds every material. The campaign detail page has a dossier editor so a
user can upload approved claims and substantiation that cascade to the whole campaign.

## Multimodal perception

`src/perception/perceive.ts` (`perceiveMaterial`) is a pre-pass: one vision-capable model
"sees" each material once and produces text artifacts that cascade to all reviewers, so even
the text-only region model (Llama) benefits and only the perception call needs image input.

Pipeline, with graceful fallback at every step (nothing throws on a missing tool/key):
1. Frames: a video plus `ffmpeg` yields evenly-spaced keyframes hosted via the `Store`; if
   `ffmpeg` is absent it falls back to seeded `perception.frames`, then a single `imageUrl`,
   then none.
2. Vision: with frames and a vision model, one call (using the multimodal `Msg` content
   blocks) returns `visualDescription`, `onScreenText`, and `detectedClaims`.
3. Audio: with a video and an STT model, a transcript; otherwise a pasted `transcript` is used.

As frames are processed the board emits `perceiving` events
`{ campaignId, materialId, frameUrl, index, total, stage: 'vision' | 'stt' | 'done' }`.

The multimodal model seam: `Msg.content` is `string | ContentBlock[]`
(`ContentBlock = { type:'text', text } | { type:'image', url }`) in `src/models/client.ts`.
A plain string behaves exactly as before (byte-identical payloads, the existing text demo is
untouched); an array maps to each provider's vision format in the four adapters
(`aiml.ts`, `featherless.ts`, `bedrock.ts`, `gemini.ts`).

### Live "analyzing" panel

`web/src/components/PerceptionPanel.tsx` consumes the `perceiving` events on the campaign
detail page: it shows the current keyframe thumbnail (it cycles as frames arrive), a
progress bar, the transcript appearing, and a per-region "watching" badge, while the
campaign matrix and materials stay visible. If perception is off, the panel simply does not
appear and everything else still works.

## Rulebook smart import and presets

Rulebooks were previously entered one rule at a time. Now (`src/domain/rulebook-import.ts`,
`src/domain/presets.ts`):

- `POST /api/rulebooks/:region/import` with `{ format: 'md' | 'json' | 'text', content }`.
  `json` is validated against the schema directly; `md`/`text` is parsed by the
  AIML-default model into a structured `Rule[]`. It returns a PROPOSAL and never persists.
- `GET /api/rulebooks/presets` serves three curated presets from `assets/presets/`
  (US FTC, EU health claims, LATAM).
- `PUT /api/rulebooks/:region` remains the save path (the user confirms a proposal first).

The Rulebooks page (`web/src/pages/RulebooksPage.tsx`) has a dropzone (.md/.json), a preset
picker, and an editable preview table; manual add/edit is preserved.

## HTTP API (added or changed)

Campaigns: `GET /api/campaigns`, `GET /api/campaigns/:id`, `POST /api/campaigns`,
`POST /api/campaigns/:id/materials`.
Campaign reviews: `GET /api/campaign-reviews/:id` (rollup + matrix),
`GET /api/campaign-reviews/:id/events` (SSE, includes `perceiving`),
`POST /api/campaign-reviews/:id/decision` (per-material human ruling).
Video: `POST /api/videos` (multipart, hosts to `data/videos/`), `GET /api/videos/:name`.
Rulebooks: `GET /api/rulebooks/presets`, `POST /api/rulebooks/:region/import`.
The single-asset endpoints (`/api/reviews*`) are unchanged.

## Web UI

- `/campaigns`: list of campaigns (name, material count, aggregate verdict badge).
- `/campaigns/:id`: dossier editor, nested materials tree (add material, including video
  upload), the material x region matrix, the live analyzing panel, and drill-in to the
  existing per-material live board.
- Key components: `CampaignMatrix.tsx`, `DossierEditor.tsx`, `MaterialsTree.tsx`,
  `VerdictBadge.tsx`, `PerceptionPanel.tsx`.

## Models and configuration

AIML is the default route. The reviewer roles are unchanged. Perception adds two roles in
`src/models/route.ts`: `perception-vision` (default `openai/gpt-5-2` on AIML, override with
`AIML_VISION_MODEL`) and `perception-stt` (a Whisper-class model, override with
`AIML_STT_MODEL`). Both honor `MODEL_MODE` (set `MODEL_MODE=dev` for the Bedrock/Vertex
cost-savers). `docs/AIML_SWITCHOVER.md` documents running fully on AIML. No Opus 4.8.

Note: the exact AIML vision and STT slugs should be confirmed against the live AIML catalog;
they are env-overridable so they can be corrected without a code change, and everything is
stubbed in tests so no credentials are needed to run the suite or the local demo.

## How to run

- Install: `npm install` (a `node_modules` symlink to the canonical `band-review-board`
  worktree is used in this repo layout).
- Tests and typecheck: `npm test` (71 tests) and `npm run typecheck`.
- Local campaign demo (no credentials): `npm run local`. Watch the `perceiving` ticks, the
  concurrent per-material negotiation, and the rollup matrix.
- Full app: `npm run serve` (Hono server, BOARD_MODE=local) and build/serve `web/`
  (`cd web && npm run build`, or the Vite dev server). Open the Campaigns page.
- band.ai product mode (BOARD_MODE=band) starts a review in app.band.ai; the multi-material
  band coordinator path is the remaining follow-up (see below).

## Tests

The suite grew from 19 to 71. New coverage: campaign load/validate and the per-key reconcile
gate (`test/campaigns-core.test.ts`); concurrent no-shared-gate orchestration, dossier
cascade in the prompt, and worst-case rollup (`test/campaigns-orchestration.test.ts`);
rulebook json/md import and presets (`test/rulebook-import.test.ts`); the multimodal `Msg`
content blocks per adapter (`test/model-content-blocks.test.ts`); and the perception pass,
its events, and its graceful fallback (`test/perception.test.ts`).

## Not done yet / follow-ups

- band.ai multi-material coordinator: the local and server paths run a campaign concurrently;
  driving many materials inside a single live band.ai room (the Coordinator posting each
  material as a follow-up task and reviewers pulling the current one) is the remaining piece.
  Single-material band mode is unchanged and still works.
- Confirm the real AIML vision and STT model slugs against the catalog (env-overridable today).
- The over-SSE run with real models needs API credentials; the proof shown is the
  fake-transport local run with the real agent wiring.
