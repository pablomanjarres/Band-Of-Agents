# Band Review Board

A marketing-compliance review board built on [band.ai](https://band.ai). A brand ships a whole campaign (a product with many marketing materials: video, posts, images, banners) into a shared Band room, and specialist agents check each material against every target market's advertising rules before it publishes. The agents do not run checks in a line: a claim that is legal in the US can be unlawful in the EU, so they genuinely disagree on the same material and have to reconcile it, and every material is negotiated concurrently. They read the actual media (video transcript and sampled frames, images), not just the copy, and they are grounded in a shared campaign dossier of approved claims and substantiation. Real deadlocks go to a human.

Built for the [Band of Agents Hackathon](https://lablab.ai) (lablab.ai), June 2026. Solo build.

> The compliance content in this repo is a hackathon demo, not legal advice.

## Why this is not a pipeline

The interesting part is the conflict, not the workflow. Three things pull against each other on the same material:

- A quantified performance claim ("cut onboarding 60%") can be fine under US FTC guidance with substantiation, but restricted in the EU.
- An EU run can require a disclosure or consent line that the US version never needed.
- A localized rewrite that fixes the legal problem can drift off-brand, which the brand reviewer pushes back on.

So the reviewers do not produce one merged checklist. They hold competing mandates, post findings, and a reconcile step issues a separate verdict per region (publish, adapt, or escalate) and surfaces the cross-region conflict. That negotiation is the point. Band is the layer it happens on: every agent is a first-class participant in the room and coordinates by @mention, not a wrapper around a script. Across a campaign the same conflict plays out per material, all at once, never serialized.

## Campaigns, cascading dossier, and multimodal review

A review is not limited to one asset. A campaign is a product with many materials (a hero video that owns its cutdown posts and thumbnail, standalone posts, banners). Each material is negotiated per region concurrently (material-1 can be remediating while material-3 is still in first review); the campaign verdict is an observation over the per-material verdicts (worst-case per region plus a material x region matrix), never a gate that serializes the work.

- Cascading dossier: a campaign carries a shared source-of-truth (approved claims, substantiation, approved info, uploaded sources) that cascades into every reviewer's prompt. Edit it once and it re-grounds every material, so a substantiated claim can publish in the US while the EU still demands a disclosure.
- Multimodal perception: a pre-pass actually sees each video and image (sampled keyframes) and hears the audio (transcript) via AIML, then feeds those text artifacts to every reviewer (so even the text-only region model benefits). A live panel in the UI shows the keyframe being analyzed cycling in real time while the campaign matrix stays visible.
- Rulebook smart import: upload a `.md` (parsed into rules by a model) or `.json` rulebook, or apply a curated preset, instead of entering rules one by one.

Full details in `docs/CAMPAIGNS.md`.

## How a review runs

```
            marketing asset (copy + hard claim + image)
                              |
                       [ Coordinator ]   loads brand DNA + per-region rulebooks
                              |
        +-------------+-------------+-------------+--------------+
        |             |             |                           |
   [ US / FTC ]  [ EU / GDPR ]  [ LATAM ]              [ Brand voice ]
        |             |             |                           |
        +------ structured findings (issue, severity, rationale) +
                              |
                       [ Reconcile ]   detect conflict, verdict per region
                              |
            +-----------------+------------------+
         publish            adapt             escalate
                              |                  |
                       [ Remediation ]     [ Human lead ]
                    rewrite copy + regen     rules on the
                    localized image, then    gray area
                    send back to review
```

1. The coordinator intakes the asset and loads the shared context (brand DNA, a rulebook per market, and, for a campaign, the dossier).
2. For a video or image material, a perception pre-pass sees the frames and hears the audio; its transcript and visual notes are cascaded to the reviewers.
3. The region reviewers and the brand reviewer review in parallel and post structured findings to the room.
4. The reconcile step detects where the reviewers conflict and issues a per-region verdict.
5. On `adapt`, the remediation agent rewrites the non-compliant copy and regenerates a localized image, then sends the asset back for re-review (a real loop, not a one-shot pass).
6. On a genuine deadlock or a hard violation, it escalates to the human, whose decision is recorded.

For a campaign this whole loop runs per material, concurrently, and a final rollup reports the worst-case verdict per region plus the material x region matrix.

## The agents

| Agent | Objective | Calls a model |
|---|---|---|
| Coordinator | Intake the asset, load brand DNA and rulebooks, recruit reviewers | No (deterministic) |
| US reviewer | Check against US / FTC advertising rules | Yes |
| EU reviewer | Check against EU advertising rules and GDPR | Yes |
| LATAM reviewer | Check against the LATAM rulebook | Yes |
| Brand reviewer | Keep localized versions on-voice across markets | Yes |
| Reconcile | Detect cross-region conflict, issue per-region verdict, escalate | No (deterministic) |
| Remediation | Rewrite copy and regenerate a localized image, re-review | Yes |
| Human lead | Adjudicate escalated gray areas | Human, not an agent |

The coordinator and reconcile steps are deterministic on purpose: routing and conflict detection are rules, so the verdict logic is auditable rather than left to a model. A perception pre-pass (not a Band agent) sees and hears each video or image material once via AIML, producing the transcript and visual artifacts that ground every reviewer.

## Multi-model by design

Each model-calling agent runs the model family that fits its job. `MODEL_MODE` switches the whole fleet between two providers behind one interface (`src/models/route.ts`):

| Agent | `aiml` (main path) | `dev` (cost-saver) |
|---|---|---|
| US reviewer | OpenAI GPT-5 | Claude Sonnet (Bedrock) |
| EU reviewer | Gemini 2.5 Pro | Gemini (Vertex) |
| LATAM reviewer | Llama 3.1 8B | Llama 3.1 8B (Featherless) |
| Brand reviewer | Claude Haiku 4.5 | Claude Haiku (Bedrock) |
| Remediation (copy) | DeepSeek | Claude Sonnet (Bedrock) |
| Remediation (image) | Gemini 2.5 Flash Image ("Nano Banana") | Gemini (Vertex) |
| Perception (vision) | vision-capable model, reads keyframes/images | (MODEL_MODE fallback) |
| Perception (audio) | Whisper-class transcription | (MODEL_MODE fallback) |

- `aiml` routes every agent through the [AI/ML API](https://aimlapi.com) OpenAI-compatible gateway, and is the path used for the high-visibility showcase calls and the Nano Banana image work.
- `dev` spreads volume across AWS Bedrock, GCP Vertex, and [Featherless](https://featherless.ai) (open-source inference) so the small AIML credit is not burned during development.
- All three modalities run through AIML: text (the reviewers), image (Nano Banana plus perception vision), and audio (perception transcription). The perception slugs are env-overridable (`AIML_VISION_MODEL`, `AIML_STT_MODEL`).

See `docs/AIML_SWITCHOVER.md` for how to run fully on AIML.

## Shared context

The agents reason against structured context loaded into the room at intake, all in `assets/`:

- `brand-dna.json`: voice, approved and forbidden vocabulary, claim boundaries, channel norms.
- `rulebook.us.json`, `rulebook.eu.json`, `rulebook.latam.json`: the per-market rules each region reviewer applies.
- `presets/rulebook.*.json`: curated rulebook presets (US FTC, EU health claims, LATAM) for one-click import.
- `sample-campaign.json`: the demo campaign, a product with a dossier and several materials including a hero video that owns its posts and thumbnail.
- `sample-asset.json`, `sample-asset-adapt.json`: the legacy single-asset demos, including one whose claim passes in one market and fails in another.

For a campaign, the dossier (approved claims and substantiation) cascades into every reviewer so claims are judged against the brand's own source-of-truth.

## Stack

TypeScript, Node 22+, pnpm, ESM. Coordination through `@band-ai/sdk`. Findings and verdicts are validated with `zod`. Model calls go through a provider-agnostic `ModelClient` (`openai` SDK for the AIML gateway, `@anthropic-ai/bedrock-sdk`, `@google/genai`) over a `string | ContentBlock[]` message seam so a single call can carry image input. A React + Tailwind console (`web/`) drives campaigns, the live board, the material x region matrix, the analyzing panel, and the rulebook editor over SSE.

## Quickstart (no API keys)

The full debate runs end to end on an in-process fake transport, so you can see it work without any keys or a Band account:

```bash
pnpm install
pnpm test          # 71 tests, fake transport + routing + perception stubs, no keys
pnpm typecheck
pnpm local         # the 3-material Immune+ campaign negotiated concurrently (perception ticks included)
pnpm local single  # the legacy single-asset debate, for comparison
```

## Run on real band.ai

1. Create one External agent per role in app.band.ai. Copy `.env.example` to `.env` and paste each agent's UUID and API key.
2. Pick a provider: set `AIML_API_KEY` with `MODEL_MODE=aiml`, or use `MODEL_MODE=dev` with AWS and GCP credentials (and `FEATHERLESS_API_KEY` for the open-model LATAM reviewer).
3. `pnpm agents` to connect the agents. Then in a Band room, add the agents and a human, and post a marketing asset that @mentions the coordinator.

The concurrent multi-material campaign path runs in local and server modes today; driving many materials inside a single live band.ai room (the Coordinator handing out each material as a follow-up task) is a tracked follow-up. Single-material band mode is unchanged.

## Repo layout

```
src/
  agents/      coordinator, region + brand reviewers, reconcile, remediation
  band/        band.ai transport (real) and an in-process fake for tests
  board/       shared board, board + campaign sessions, event model
  domain/      campaign / asset / rulebook types, rulebook import, presets
  models/      ModelClient (text + image blocks), per-provider adapters, MODEL_MODE routing
  perception/  multimodal pre-pass (keyframes, vision, transcript)
  run/         local demo, real-agent runner, connection + model smoke tests
assets/        brand DNA, per-region rulebooks, presets, sample campaign + assets
web/           React + Tailwind console (campaigns, matrix, analyzing panel, rulebooks)
docs/          AIML switchover guide, campaigns + multimodal doc, design specs
test/          walking-skeleton rungs, campaigns, rulebook import, content blocks, perception
```

## Submission

Band of Agents Hackathon, deadline June 19, 2026, 10:00 AM CST.

- Hosted demo: TODO
- Application URL: TODO
- Slide deck: TODO
- Video walkthrough: TODO

## License

MIT. See `LICENSE`.
