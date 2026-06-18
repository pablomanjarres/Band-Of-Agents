# Band Review Board

A room of specialist agents that clears a global brand's campaign against every target market's advertising and regulatory rules in minutes, catches the cross-border conflicts a single legal team misses, and proves every decision with an audit trail.

Built for the [Band of Agents Hackathon](https://lablab.ai) (lablab.ai), June 2026. Solo build.

**Hosted demo:** [artifact-viewer-one.vercel.app](https://artifact-viewer-one.vercel.app)

> The compliance content here is a hackathon demo, not legal advice.

---

## The problem

A global brand ships one campaign to six markets. In the US the claim is legal. In the EU the same claim is a regulatory violation, and the fine for getting it wrong runs to 4% of global annual revenue. Today the only thing between the brand and that fine is a slow chain of market-by-market legal reviews that take a week each. We replaced that chain with a room of agents that catches the conflict in minutes, per market, with a full audit trail.

This is not a content-review tool. It is a regulatory risk shield. "Save the marketing team some time" is a nice-to-have. "Stop shipping a claim that triggers a fine worth 4% of global revenue" is a budget line nobody argues with.

**The pain is multiplicative.** Not one review. Every campaign, every asset, every market, continuously. A brand in 20 markets running weekly campaigns has a compliance surface in the thousands of reviews a year. A single asset sold into several markets faces parallel, stacked liability, because each jurisdiction sets its own rules, ceilings, and required disclosures.

**Before.** Six markets, a week or more each, market-specific legal expertise required, an uncapped fine if one slips. No audit trail of edits.

**After.** Minutes. One human ruling on the genuine gray area. Every verdict traceable to a rule and an agent.

### What is at stake (cited figures)

| Jurisdiction | Ceiling |
|---|---|
| GDPR (EU) | 20 million euro or **4% of global annual turnover**, whichever is higher. Over 7.1 billion euro in fines since 2018. Meta: 1.2B euro. TikTok: 530M euro. |
| UK DMCC Act | Up to **10% of global turnover** for misleading-practice breaches (effective April 2025, higher ceiling than GDPR) |
| US FTC | Up to ~50,000 USD **per violation**; one campaign is many violations. In one sweep the FTC warned 670+ advertisers including Coca-Cola, Pepsi, Amazon, and Unilever over "clinically proven" claims. |
| EU Green Transition Directive | Binding enforcement floor across all 27 member states from late 2026, each with its own ceiling |

Global ad spend surpassed **1 trillion dollars** for the first time in 2026. Every dollar carries jurisdictional claim risk.

### Ready-to-demo conflicts (legal in one market, illegal in another)

- **Health efficacy claim** ("clinically proven to boost your immune system"): allowed in the US with FTC-grade substantiation, an unauthorized claim under EU cosmetics rules.
- **Environmental claim** ("carbon neutral"): actionable in the EU and UK (TotalEnergies 10,000 euro/day, Apple Watch barred in Germany); looser under US FTC Green Guides.
- **Comparative advertising** ("better than brand X"): common and legal in the US, restricted across several EU and LATAM markets.
- **DTC pharma promotion**: legal in the US, banned across the EU.
- A US-compliant consent line that violates EU GDPR consent rules on the campaign landing page.

---

## Why this is not a pipeline

The interesting part is the conflict, not the workflow. The agents hold competing mandates and have to reconcile them. In the regulatory pod, when two region reviewers split on the same span, the Reg Lead runs a one-round rebuttal where each blocking region holds or concedes, on the record, before anything consolidates. That negotiation is the point.

Band is the layer it happens on: every agent is a first-class participant in the room that coordinates by @mention and narrates its reasoning, not a wrapper around a script. The spine that drives the final verdict is deterministic, so every decision is fully auditable.

Two orchestration topologies ship and coexist. The live workflow is the **pods cast** ("blackboard pods on a decision spine"), the real Band.ai showcase you connect with `pnpm agents`: 17 agents plus a human, organized into three deliberating pods on a deterministic decision spine. A lighter **classic cast** (Coordinator to US/EU/LATAM/Brand to Reconcile, per-region verdicts) backs the web portal's "Run review" button.

---

## Workflow diagrams

### Pods cast (the live Band.ai showcase)

<p align="center">
<img src="assets/pods-flow.svg" alt="Pods cast workflow" width="900"/>
</p>

The flow in plain language:

1. Human posts the asset and @mentions the Conductor. The Conductor fans it out to the three pods.
2. Each pod deliberates in parallel. In the Regulatory pod, when reviewers split on the same span, the Reg Lead runs a one-round rebuttal: each blocking region holds or concedes, on the record.
3. Each pod files one consolidated finding to the board.
4. The Risk Adjudicator scores the board. On a cross-pod conflict it consults the Mediator for the smallest resolution.
5. If anything still blocks, the Adjudicator surfaces exactly what is wrong and asks the human to approve a fix or spike the asset.
6. On approval, one Remediation pass rewrites the blocked copy, regenerates a localized image, and recommits for re-review. On a genuine deadlock, the Compliance Lead (human) rules, and that ruling is logged as precedent.
7. Terminal state: **published**, **spiked**, or a **per-market publish** (markets that cleared ship the original; markets that required a fix ship the localized version).

### Classic cast (portal "Run review" flow)

<p align="center">
<img src="assets/classic-flow.svg" alt="Classic cast workflow" width="700"/>
</p>

---

## Campaigns, cascading dossier, and multimodal review

A review is not limited to one asset. A campaign is a product with many materials (a hero video that owns its cutdown posts and thumbnail, standalone posts, banners). Each material is negotiated per region concurrently; the campaign verdict is an observation over the per-material verdicts (worst-case per region plus a material x region matrix), never a gate that serializes the work.

- **Cascading dossier:** a campaign carries a shared source-of-truth (approved claims, substantiation, uploaded sources) that cascades into every reviewer's prompt. Edit it once and it re-grounds every material, so a substantiated claim can publish in the US while the EU still demands a disclosure.
- **Multimodal perception:** a pre-pass actually sees each video and image (sampled keyframes) and hears the audio (transcript) via AIML, then feeds those artifacts to every reviewer. Even a text-only region model benefits.
- **Rulebook smart import:** upload a `.md` (parsed into rules by a model) or `.json` rulebook, or apply a curated preset (US FTC, EU health claims, LATAM), instead of entering rules one by one.

Full details in `docs/CAMPAIGNS.md`.

---

## The cast

The live pods cast is 17 agents plus one human (the Compliance Lead).

| Agent | Objective | Calls a model |
|---|---|---|
| Conductor | Fan the asset to the three pods, own the single recommit; the only agent a human tags | No (deterministic) |
| Scout | Map the risky surfaces (claims, CTAs, image) as work-items | Yes |
| Claim & Evidence | Flag claims not substantiated by the asset | Yes |
| Precedent | Attach relevant prior rulings | Yes |
| Disclosure | Draft any mandatory disclosure text | Yes |
| US / EU / LATAM reviewers | Check against each market's rulebook; hold or concede in the rebuttal round | Yes |
| Brand Voice / Channel Fit / Visual | Keep copy, format, and image on-brand | Yes |
| Claims / Regulatory / Brand Leads | Collect positions, run the rebuttal (Reg Lead), file one consolidated finding | No (deterministic) |
| Mediator | Broker a cross-pod conflict into the smallest resolution, or report a deadlock | Yes |
| Remediation | Rewrite blocked copy and regenerate a localized image, recommit | Yes |
| Risk Adjudicator | Score the board, run the mediation/remediation cycle, drive the terminal decision, summon the human | No (deterministic) |
| Compliance Lead | Rule on the genuine deadlock; ruling logged as precedent | Human |

The spine (Conductor, pod leads, Risk Adjudicator) is deterministic by design: routing and the verdict logic are auditable, not left to a model.

---

## Multi-model by design

Each model-calling agent runs the model family that fits its job. `MODEL_MODE` switches the whole fleet behind one interface. For the live Band.ai room, `MODEL_MODE=vertex` runs everything on Gemini/Vertex from a single GCP credential.

| Agent | `aiml` (main path) | `dev` (cost-saver) |
|---|---|---|
| Scout, LATAM | Llama 3.1 8B (Featherless) | Llama 3.1 8B (Featherless) |
| US reviewer | OpenAI GPT-5 | Claude Sonnet (Bedrock) |
| EU reviewer, Claim & Evidence | Gemini 2.5 Pro | Gemini (Vertex) |
| Precedent, Channel, Visual | Gemini 2.5 Flash | Gemini (Vertex) |
| Disclosure | Claude Sonnet | Claude Sonnet (Bedrock) |
| Brand Voice | Claude Haiku 4.5 | Claude Haiku (Bedrock) |
| Mediator | Claude Opus | Claude Opus (Bedrock) |
| Remediation (copy) | DeepSeek | Claude Sonnet (Bedrock) |
| Remediation (image) | Gemini 2.5 Flash Image ("Nano Banana") | Gemini (Vertex) |
| Perception (vision + audio) | AIML vision + Whisper-class STT | Vertex fallback |

`vertex` routes the whole fleet through GCP Vertex on one credential. `aiml` routes through the [AI/ML API](https://aimlapi.com) gateway, used for the high-visibility showcase calls and the Nano Banana image work. `dev` spreads across AWS Bedrock, GCP Vertex, and [Featherless](https://featherless.ai) for volume.

---

## A live run

On real models, the sample asset drives the full negotiation. A representative run:

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

The EU reviewer genuinely holds its block on rebuttal. The pod files a real cross-region conflict. The board fails to mediate it. One remediation cycle runs. The deadlock escalates to the human. Nothing about the outcome is hard-coded, so it varies run to run.

---

## Stack

TypeScript, Node 22+, pnpm, ESM. Coordination through `@band-ai/sdk` behind a transport seam (a real band.ai transport and an in-process fake for tests). Findings and verdicts are validated with `zod`. Model calls go through a provider-agnostic `ModelClient` (the `openai` SDK for the AIML gateway, `@anthropic-ai/bedrock-sdk`, `@google/genai`) over a `string | ContentBlock[]` message seam so a single call can carry image input. A Hono server streams the review to a React + Tailwind console (`web/`) over SSE, driving campaigns, the live board, the material x region matrix, the analyzing panel, and the rulebook editor.

---

## Quickstart (no API keys)

The full pods debate runs end to end on an in-process fake transport with no keys and no Band account:

```bash
pnpm install
pnpm test          # full suite, fake transport + routing + perception stubs
pnpm typecheck
pnpm local pods    # pods -> board -> spine walking skeleton on the sample asset
pnpm local         # Immune+ campaign negotiated concurrently (perception ticks included)
pnpm local single  # legacy single-asset debate, for comparison
```

## Run it for real

**Hosted demo:** [artifact-viewer-one.vercel.app](https://artifact-viewer-one.vercel.app)

The live Band.ai room (the real workflow, the pods cast):

```bash
MODEL_MODE=vertex pnpm agents   # connects the 17-agent cast to band.ai on one GCP credential
```

Create a band.ai room, add the agents plus the human (the Compliance Lead), then post `@Conductor review <campaign name>`. One External agent per handle (`@conductor`, `@scout`, `@claim-evidence`, `@precedent`, `@disclosure`, `@reg-lead`, `@claims-lead`, `@brand-lead`, `@us-reviewer`, `@eu-reviewer`, `@latam-reviewer`, `@brand-voice`, `@channel`, `@visual`, `@mediator`, `@remediation`, `@adjudicator`). Paste each UUID and API key into `.env`. Swap `MODEL_MODE=aiml` (with `AIML_API_KEY`) to route through the AI/ML API, or `MODEL_MODE=dev` for Bedrock + Vertex + Featherless.

The classic cast backs the web console's "Run review" button (real models, no Band account needed):

```bash
MODEL_MODE=dev BOARD_MODE=local pnpm serve   # open http://localhost:8787
pnpm serve:band                              # console driving a live band.ai room
pnpm agents:classic                          # classic cast in a band.ai room
```

## Repo layout

```
src/
  agents/      pods cast and the classic board
  band/        band.ai transport (real) and in-process fake for tests
  board/       shared board, campaign sessions, the pods session, event model
  domain/      campaign / asset / rulebook / finding types, rulebook import, presets
  models/      ModelClient, per-provider adapters, MODEL_MODE routing
  perception/  multimodal pre-pass (keyframes, vision, transcript)
  run/         local demo, real-agent runner, connection + model smoke tests
  server/      Hono HTTP + SSE backend
assets/        brand DNA, per-region rulebooks, presets, sample campaign + assets
web/           React + Tailwind console (campaigns, matrix, analyzing panel, rulebooks)
docs/          AIML switchover guide, campaigns + multimodal doc, design specs
test/          walking-skeleton rungs, campaigns, pods, rulebook import, perception
```

## Submission

Band of Agents Hackathon, deadline June 19, 2026, 10:00 AM CST.

- Hosted demo: [artifact-viewer-one.vercel.app](https://artifact-viewer-one.vercel.app)

## License

MIT. See `LICENSE`.
