# Band Review Board

A marketing-compliance review board built on [band.ai](https://band.ai). A brand ships a whole campaign (a product with many marketing materials: video, posts, images, banners) into a shared Band room, and specialist agents clear each material against every target market's advertising and regulatory rules before it publishes, catching the cross-border conflicts a single legal team misses and proving every verdict with an audit trail.

The agents do not run checks in a line: a claim that is legal in the US can be a regulatory violation in the EU, where the fine for getting it wrong runs to 4% of global annual revenue. So they genuinely disagree on the same material and have to reconcile it, and every material is negotiated concurrently. They read the actual media (video transcript and sampled frames, images), not just the copy, and they are grounded in a shared campaign dossier of approved claims and substantiation. Real deadlocks go to a human, on a logged, defensible decision.

Built for the [Band of Agents Hackathon](https://lablab.ai) (lablab.ai), June 2026. Solo build.

> The compliance content here is a hackathon demo, not legal advice.

## What it is actually for

Not a content-review tool, a regulatory risk shield. "Save the marketing team some time" is a nice-to-have. "Stop shipping a claim that triggers a fine worth 4% of global revenue" is a budget line nobody argues with. The pain is multiplicative: every campaign, every asset, every market, continuously. A single asset sold into several markets faces parallel, stacked liability, because each jurisdiction sets its own rules, ceilings, and required disclosures. That stacked conflict is exactly what these agents surface and a single reviewer misses.

The safe anchors on the downside: GDPR fines up to 20 million euro or 4% of global turnover; the UK DMCC Act up to 10% of global turnover; US FTC penalties per violation on unsubstantiated claims, where one campaign is many violations. Before: six markets, a week or more each, an uncapped fine if one slips. After: minutes, one human ruling on the genuine gray area, every verdict traceable to a rule and an agent.

## Why this is not a pipeline

The interesting part is the conflict, not the workflow. The agents do not run checks in a line and merge a checklist. They hold competing mandates and have to reconcile them. Three things pull against each other on the same material:

- A quantified or efficacy claim ("clinically proven to boost your immune system") can pass in the US with substantiation and be an unauthorized health claim in the EU.
- An EU fix can require a disclosure or consent line the US version never needed.
- A localized rewrite that fixes the legal problem can drift off-brand, which the brand reviewers push back on.

So the reviewers do not produce one merged checklist. They post findings, and a reconcile step issues a separate verdict per region (publish, adapt, or escalate) and surfaces the cross-region conflict. That negotiation is the point. Band is the layer it happens on: every agent is a first-class participant in the room that coordinates by @mention and narrates its reasoning, not a wrapper around a script. Across a campaign the same conflict plays out per material, all at once, never serialized.

Two orchestration topologies ship and coexist. The default is the Coordinator/Reconcile board with the full campaign + multimodal flow (below). An additive, opt-in redesign ("blackboard pods on a decision spine", `BOARD_TOPOLOGY=pods`) makes the negotiation explicit: small pods debate internally, a shared board reconciles cross-pod conflict, and a decision spine drives the asset to a terminal verdict.

## Campaigns, cascading dossier, and multimodal review

A review is not limited to one asset. A campaign is a product with many materials (a hero video that owns its cutdown posts and thumbnail, standalone posts, banners). Each material is negotiated per region concurrently (material-1 can be remediating while material-3 is still in first review); the campaign verdict is an observation over the per-material verdicts (worst-case per region plus a material x region matrix), never a gate that serializes the work.

- Cascading dossier: a campaign carries a shared source-of-truth (approved claims, substantiation, approved info, uploaded sources) that cascades into every reviewer's prompt. Edit it once and it re-grounds every material, so a substantiated claim can publish in the US while the EU still demands a disclosure.
- Multimodal perception: a pre-pass actually sees each video and image (sampled keyframes) and hears the audio (transcript) via AIML, then feeds those text artifacts to every reviewer (so even the text-only region model benefits). A live panel in the UI shows the keyframe being analyzed cycling in real time while the campaign matrix stays visible.
- Rulebook smart import: upload a `.md` (parsed into rules by a model) or `.json` rulebook, or apply a curated preset, instead of entering rules one by one.

Full details in `docs/CAMPAIGNS.md`.

## How a review runs (pods to board to spine)

```
            marketing asset (copy + hard claim + image)
                              |
                        [ Conductor ]        sequences the pods, owns the recommit loop
                              |
      +-----------------------+------------------------+
      |                       |                        |
 [ Claims pod ]        [ Regulatory pod ]        [ Brand pod ]
  Scout, Claim &        US, EU, LATAM             Brand Voice,
  Evidence,             reviewers that DEBATE     Channel, Visual
  Precedent,            a blocked span before     under a Brand Lead
  Disclosure            the lead consolidates,
  under a Claims Lead   under a Reg Lead
      |                       |                        |
      +------ one PodFinding each (findings + conflicts) -------+
                              |
                      [ Board: Mediator ]   brokers a cross-pod conflict
                              |
                     [ Risk Adjudicator ]   scores the board, drives the spine
                              |
      +-----------+-----------+-----------+------------+
   publish      spike      remediate     escalate
                              |              |
                      [ Remediation ]   [ Human lead ]
                      rewrite copy +     rules on the
                      regen image,       genuine deadlock;
                      recommit (capped)  ruling logged as precedent
```

The default Coordinator/Reconcile flow (per material, all materials concurrently):

1. The coordinator intakes the material and loads the shared context (brand DNA, a rulebook per market, and, for a campaign, the dossier).
2. For a video or image material, a perception pre-pass sees the frames and hears the audio; its transcript and visual notes are cascaded to the reviewers.
3. The region reviewers and the brand reviewer review in parallel and post structured findings to the room.
4. The reconcile step detects where the reviewers conflict and issues a per-region verdict.
5. On `adapt`, the remediation agent rewrites the non-compliant copy and regenerates a localized image, then sends the asset back for re-review (a real loop, not a one-shot pass).
6. On a genuine deadlock or a hard violation, it escalates to the human, whose decision is recorded.

For a campaign this whole loop runs per material, concurrently, and a final rollup reports the worst-case verdict per region plus the material x region matrix.

The opt-in pods topology (`BOARD_TOPOLOGY=pods`), diagrammed above:

1. The Conductor intakes the asset and fans it to the three pods.
2. Each pod deliberates and files one consolidated PodFinding. In the Regulatory pod, when reviewers split on the same span, they exchange a directed rebuttal round (one reviewer challenges another with the peer's argument; the peer holds or concedes) before the lead consolidates. That is the genuine agent-to-agent debate.
3. The Risk Adjudicator accumulates the pod findings. On a conflict it consults the Mediator.
4. If the conflict will not resolve, it remediates once (Remediation rewrites the copy and regenerates a localized image, then the asset recommits through the Conductor), then escalates the genuine deadlock to the human. The Risk Adjudicator is the only agent that summons the human.
5. The spine ends in a terminal state: publish, spike, or escalate, with the human ruling logged as precedent.

## The cast

| Agent | Objective | Calls a model |
|---|---|---|
| Conductor | Fan the asset to the pods, run the one recommit loop | No (deterministic) |
| Scout | Extract the risky surfaces (claims, CTAs, image) as work-items | Yes |
| Claim & Evidence | Flag claims not substantiated by the asset | Yes |
| Precedent | Attach relevant prior rulings | Yes |
| Disclosure | Draft any mandatory disclosure text | Yes |
| US / EU / LATAM reviewers | Check against each market's rulebook; debate a contested span | Yes |
| Brand Voice / Channel / Visual | Keep copy, format, and image on-brand | Yes |
| Claims / Regulatory / Brand Leads | Collect positions, run the rebuttal, file one PodFinding | No (deterministic) |
| Mediator | Broker a cross-pod conflict into the smallest resolution | Yes |
| Remediation | Rewrite copy and regenerate a localized image, recommit | Yes |
| Risk Adjudicator | Score the board, drive the terminal decision, summon the human | No (deterministic) |
| Human lead | Adjudicate the genuine gray area | Human, not an agent |

The orchestration steps are deterministic on purpose: in the classic flow the coordinator and reconcile steps, and in the pods flow the leads, the Conductor, and the Risk Adjudicator, are rules-based, so routing and the verdict logic are auditable rather than left to a model. The Coordinator/Reconcile board is the default server flow; the pods topology is the additive redesign, selected with `BOARD_TOPOLOGY=pods`. A perception pre-pass (not a Band agent) sees and hears each video or image material once via AIML, producing the transcript and visual artifacts that ground every reviewer.

## Multi-model by design

Each model-calling agent runs the model family that fits its job. `MODEL_MODE` switches the whole fleet between two providers behind one interface (`src/models/route.ts`).

| Agent | `aiml` (main path) | `dev` (cost-saver) |
|---|---|---|
| Scout, LATAM | Llama 3.1 8B | Llama 3.1 8B (Featherless, open model) |
| US reviewer | OpenAI GPT-5 | Claude Sonnet (Bedrock) |
| EU reviewer, Claim & Evidence | Gemini 2.5 Pro | Gemini (Vertex) |
| LATAM reviewer | Llama 3.1 8B | Llama 3.1 8B (Featherless) |
| Precedent, Channel, Visual | Gemini 2.5 Flash | Gemini (Vertex) |
| Disclosure | Claude Sonnet | Claude Sonnet (Bedrock) |
| Brand reviewer / Brand Voice | Claude Haiku 4.5 | Claude Haiku (Bedrock) |
| Mediator | Claude Opus | Claude Opus (Bedrock) |
| Remediation (copy) | DeepSeek | Claude Sonnet (Bedrock) |
| Remediation (image) | Gemini 2.5 Flash Image ("Nano Banana") | Gemini (Vertex) |
| Perception (vision) | vision-capable model, reads keyframes/images | (MODEL_MODE fallback) |
| Perception (audio) | Whisper-class transcription | (MODEL_MODE fallback) |

- `aiml` routes every agent through the [AI/ML API](https://aimlapi.com) OpenAI-compatible gateway, and is the path used for the high-visibility showcase calls and the Nano Banana image work.
- `dev` spreads volume across AWS Bedrock, GCP Vertex, and [Featherless](https://featherless.ai) (open-source inference) so the small AIML credit is not burned during development.
- All three modalities run through AIML: text (the reviewers), image (Nano Banana plus perception vision), and audio (perception transcription). The perception slugs are env-overridable (`AIML_VISION_MODEL`, `AIML_STT_MODEL`).

## The debate is real (a live run)

On real models (dev mode), the sample asset drives the full negotiation, not a scripted demo. A representative run:

```
Reg Lead: regulatory pod deliberating (3 members)
EU Reviewer rebuts on "clinically proven to boost your immune system": hold
EU Reviewer rebuts on "9 out of 10 users felt healthier in two weeks": hold
Reg Lead: regulatory pod: 8 findings, 3 conflict(s)
Risk Adjudicator: 3 conflict(s), consulting mediator
Mediator: no movement
Risk Adjudicator: remediate (attempt 1)
... asset recommits, pods re-deliberate ...
Risk Adjudicator: deadlock, escalating
Human ruling: spiked      ->      terminal: spiked
```

The EU reviewer genuinely holds its block on rebuttal, the pod files a real cross-region conflict, the board fails to mediate it, one remediation cycle runs, and the deadlock escalates to the human. Nothing about the outcome is hard-coded, so it varies run to run.

## Shared context

The agents reason against structured context in `assets/`:

- `brand-dna.json`: voice, approved and forbidden vocabulary, claim boundaries, channel norms.
- `rulebook.us.json`, `rulebook.eu.json`, `rulebook.latam.json`: the per-market rules each region reviewer applies.
- `presets/rulebook.*.json`: curated rulebook presets (US FTC, EU health claims, LATAM) for one-click import.
- `sample-campaign.json`: the demo campaign, a product with a dossier and several materials including a hero video that owns its posts and thumbnail.
- `sample-asset.json`, `sample-asset-adapt.json`: the legacy single-asset demos, including one whose claim passes in one market and fails in another.

For a campaign, the dossier (approved claims and substantiation) cascades into every reviewer so claims are judged against the brand's own source-of-truth.

## Stack

TypeScript, Node 22+, pnpm, ESM. Coordination through `@band-ai/sdk` behind a transport seam (a real band.ai transport and an in-process fake for tests). Findings and verdicts are validated with `zod`. Model calls go through a provider-agnostic `ModelClient` (the `openai` SDK for the AIML gateway, `@anthropic-ai/bedrock-sdk`, `@google/genai`) over a `string | ContentBlock[]` message seam so a single call can carry image input. A Hono server streams the review to a React + Tailwind console (`web/`) over SSE, driving campaigns, the live board, the material x region matrix, the analyzing panel, and the rulebook editor.

## Quickstart (no API keys)

The full pods debate runs end to end on an in-process fake transport, so you can see it work with no keys and no Band account:

```bash
pnpm install
pnpm test          # full suite, fake transport + routing + perception stubs, no keys
pnpm typecheck
pnpm local         # the Immune+ campaign negotiated concurrently (perception ticks included)
pnpm local single  # the legacy single-asset debate, for comparison
pnpm local pods    # the opt-in pods -> board -> spine walking skeleton on the sample asset
```

## Run it for real

Real models, no Band account needed (in-process transport, real LLMs streamed to the console):

```bash
# dev providers: AWS Bedrock + GCP Vertex + Featherless
MODEL_MODE=dev BOARD_MODE=local BOARD_TOPOLOGY=pods pnpm serve
# open http://localhost:8787, submit a campaign, watch the pods debate live
```

Or set `AIML_API_KEY` with `MODEL_MODE=aiml` to route the whole fleet through the AI/ML API.

Live band.ai room:

```bash
pnpm agents       # connects the cast to band.ai; needs one External agent per role in .env
```

Create one External agent per handle in app.band.ai (`@conductor`, `@scout`, `@claim-evidence`, `@precedent`, `@disclosure`, `@reg-lead`, `@claims-lead`, `@brand-lead`, `@us-reviewer`, `@eu-reviewer`, `@latam-reviewer`, `@brand-voice`, `@channel`, `@visual`, `@mediator`, `@remediation`, `@adjudicator`) plus a human, paste each UUID and API key into `.env`, then post a marketing asset that @mentions the Conductor.

The concurrent multi-material campaign path runs in local and server modes today; driving many materials inside a single live band.ai room (the Coordinator handing out each material as a follow-up task) is a tracked follow-up. Single-material band mode is unchanged.

## Repo layout

```
src/
  agents/      pods cast (conductor, pod leads, knowledge sources, mediator,
               risk adjudicator) and the classic board (coordinator, region +
               brand reviewers, reconcile, remediation)
  band/        band.ai transport (real) and an in-process fake for tests
  board/       shared board, board + campaign sessions, the pods session, event model
  domain/      campaign / asset / rulebook / finding types, rulebook import, presets
  models/      ModelClient (text + image blocks), per-provider adapters, MODEL_MODE routing
  perception/  multimodal pre-pass (keyframes, vision, transcript)
  run/         local demo, real-agent runner, connection + model smoke tests
  server/      Hono HTTP + SSE backend
assets/        brand DNA, per-region rulebooks, presets, sample campaign + assets
web/           React + Tailwind console (campaigns, matrix, analyzing panel, rulebooks, pods diagram)
docs/          AIML switchover guide, campaigns + multimodal doc, design specs
test/          walking-skeleton rungs, campaigns, pods, rulebook import, content blocks, perception

```

## Submission

Band of Agents Hackathon, deadline June 19, 2026, 10:00 AM CST.

- Hosted demo: TODO
- Application URL: TODO
- Slide deck: TODO
- Video walkthrough: TODO

## License

MIT. See `LICENSE`.
