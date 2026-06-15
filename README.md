# Band Review Board

A room of specialist AI agents that clears a global brand's campaign against every target market's advertising and regulatory rules in minutes, catches the cross-border conflicts a single legal team misses, and proves every verdict with an audit trail. Built on [band.ai](https://band.ai).

A claim that is legal in the US can be a regulatory violation in the EU, where the fine for getting it wrong runs to 4% of global annual revenue. Today the only thing between a brand and that fine is a slow chain of market-by-market legal reviews, a week or more each. This replaces that chain with a room of agents that surface the conflict per market, in minutes, and end on a logged, defensible decision.

Built for the [Band of Agents Hackathon](https://lablab.ai) (lablab.ai), June 2026. Solo build.

> The compliance content here is a hackathon demo, not legal advice.

## What it is actually for

Not a content-review tool, a regulatory risk shield. "Save the marketing team some time" is a nice-to-have. "Stop shipping a claim that triggers a fine worth 4% of global revenue" is a budget line nobody argues with. The pain is multiplicative: every campaign, every asset, every market, continuously. A single asset sold into several markets faces parallel, stacked liability, because each jurisdiction sets its own rules, ceilings, and required disclosures. That stacked conflict is exactly what these agents surface and a single reviewer misses.

The safe anchors on the downside: GDPR fines up to 20 million euro or 4% of global turnover; the UK DMCC Act up to 10% of global turnover; US FTC penalties per violation on unsubstantiated claims, where one campaign is many violations. Before: six markets, a week or more each, an uncapped fine if one slips. After: minutes, one human ruling on the genuine gray area, every verdict traceable to a rule and an agent.

## Why this is not a pipeline

The interesting part is the conflict, not the workflow. The agents do not run checks in a line and merge a checklist. They hold competing mandates and have to reconcile them:

- A quantified or efficacy claim ("clinically proven to boost your immune system") can pass in the US with substantiation and be an unauthorized health claim in the EU.
- An EU fix can require a disclosure or consent line the US version never needed.
- A localized rewrite that fixes the legal problem can drift off-brand, which the brand reviewers push back on.

So the work is a negotiation. In the redesigned orchestration ("blackboard pods on a decision spine") that negotiation is explicit: small pods debate internally, a shared board reconciles cross-pod conflict, and a decision spine drives the asset to a terminal verdict. Band is the layer it happens on: every agent is a first-class participant that coordinates by @mention and narrates its reasoning, not a wrapper around a script.

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

The leads, the Conductor, and the Risk Adjudicator are deterministic on purpose: routing and the verdict logic are rules, so the decision is auditable rather than left to a model. The original Coordinator/Reconcile board also ships and is the default server flow; the pods topology is the redesign, selected with `BOARD_TOPOLOGY=pods`.

## Multi-model by design

Each model-calling agent runs the model family that fits its job. `MODEL_MODE` switches the whole fleet between two providers behind one interface (`src/models/route.ts`).

| Agent | `aiml` (main path) | `dev` (cost-saver) |
|---|---|---|
| Scout, LATAM | Llama 3.1 8B | Llama 3.1 8B (Featherless, open model) |
| US reviewer | OpenAI GPT-5 | Claude Sonnet (Bedrock) |
| EU reviewer, Claim & Evidence | Gemini 2.5 Pro | Gemini (Vertex) |
| Precedent, Channel, Visual | Gemini 2.5 Flash | Gemini (Vertex) |
| Disclosure | Claude Sonnet | Claude Sonnet (Bedrock) |
| Brand Voice | Claude Haiku 4.5 | Claude Haiku (Bedrock) |
| Mediator | Claude Opus | Claude Opus (Bedrock) |
| Remediation copy | DeepSeek | Claude Sonnet (Bedrock) |
| Remediation image | Gemini 2.5 Flash Image ("Nano Banana") | Gemini (Vertex) |

- `aiml` routes every agent through the [AI/ML API](https://aimlapi.com) gateway, the path for the high-visibility showcase calls and the Nano Banana image work.
- `dev` spreads volume across AWS Bedrock, GCP Vertex, and [Featherless](https://featherless.ai) so the AIML credit is not burned during development.

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
- `sample-asset.json`: a demo asset whose claim passes in one market and fails in another.

## Stack

TypeScript, Node 22+, pnpm, ESM. Coordination through `@band-ai/sdk` behind a transport seam (a real band.ai transport and an in-process fake for tests). Findings and verdicts are validated with `zod`. Model calls go through a provider-agnostic `ModelClient` (the `openai` SDK for the AIML gateway, `@anthropic-ai/bedrock-sdk`, `@google/genai`). A Hono server streams the review to a React + Tailwind console over SSE.

## Quickstart (no API keys)

The full pods debate runs end to end on an in-process fake transport, so you can see it work with no keys and no Band account:

```bash
pnpm install
pnpm test         # 54 tests across 31 files, fake transport, no keys
pnpm typecheck
pnpm local        # the pods -> board -> spine walking skeleton on the sample asset
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

## Repo layout

```
src/
  agents/    pods cast (conductor, pod leads, knowledge sources, mediator,
             risk adjudicator) and the classic board (coordinator, reviewers,
             reconcile, remediation)
  board/     the pods session and the classic session over the transport seam,
             plus the event model the console renders
  band/      band.ai transport (real) and an in-process fake for tests
  domain/    asset / rulebook / finding / board types and loaders
  models/    ModelClient interface, per-provider adapters, MODEL_MODE routing
  run/       local demo, real-agent runner, smoke tests
  server/    Hono HTTP + SSE backend
web/         React + Tailwind live board (pods + board + spine diagram)
assets/      brand DNA, per-region rulebooks, sample assets
test/        domain, agents, pods walking skeleton, classic board, routing
```

## Submission

Band of Agents Hackathon, deadline June 19, 2026, 10:00 AM CST.

- Hosted demo: TODO
- Application URL: TODO
- Slide deck: TODO
- Video walkthrough: TODO

## License

MIT. See `LICENSE`.
