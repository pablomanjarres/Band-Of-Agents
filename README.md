# Band Review Board

A marketing-compliance review board built on [band.ai](https://band.ai). A brand ships one campaign asset into a shared Band room, and specialist agents check it against each target market's advertising rules before it publishes. The agents do not run checks in a line: a claim that is legal in the US can be unlawful in the EU, so they genuinely disagree on the same asset and have to reconcile it. Real deadlocks go to a human.

Built for the [Band of Agents Hackathon](https://lablab.ai) (lablab.ai), June 2026. Solo build.

> The compliance content in this repo is a hackathon demo, not legal advice.

## Why this is not a pipeline

The interesting part is the conflict, not the workflow. Three things pull against each other on the same piece of copy:

- A quantified performance claim ("cut onboarding 60%") can be fine under US FTC guidance with substantiation, but restricted in the EU.
- An EU run can require a disclosure or consent line that the US version never needed.
- A localized rewrite that fixes the legal problem can drift off-brand, which the brand reviewer pushes back on.

So the reviewers do not produce one merged checklist. They hold competing mandates, post findings, and a reconcile step has to issue a separate verdict per region (publish, adapt, or escalate) and surface the cross-region conflict. That negotiation is the point. Band is the layer it happens on: every agent is a first-class participant in the room and coordinates by @mention, not a wrapper around a script.

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

1. The coordinator intakes the asset and loads the shared context (brand DNA plus a rulebook per market).
2. The region reviewers and the brand reviewer review in parallel and post structured findings to the room.
3. The reconcile step detects where the reviewers conflict and issues a per-region verdict.
4. On `adapt`, the remediation agent rewrites the non-compliant copy and regenerates a localized image, then sends the asset back for re-review (a real loop, not a one-shot pass).
5. On a genuine deadlock or a hard violation, it escalates to the human, whose decision is recorded.

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

The coordinator and reconcile steps are deterministic on purpose: routing and conflict detection are rules, so the verdict logic is auditable rather than left to a model.

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

- `aiml` routes every agent through the [AI/ML API](https://aimlapi.com) OpenAI-compatible gateway, and is the path used for the high-visibility showcase calls and the Nano Banana image work.
- `dev` spreads volume across AWS Bedrock, GCP Vertex, and [Featherless](https://featherless.ai) (open-source inference) so the small AIML credit is not burned during development.

See `docs/AIML_SWITCHOVER.md` for how to run fully on AIML.

## Shared context

The agents reason against structured context loaded into the room at intake, all in `assets/`:

- `brand-dna.json`: voice, approved and forbidden vocabulary, claim boundaries, channel norms.
- `rulebook.us.json`, `rulebook.eu.json`, `rulebook.latam.json`: the per-market rules each region reviewer applies.
- `sample-asset.json`, `sample-asset-adapt.json`: the demo assets, including one whose claim passes in one market and fails in another.

## Stack

TypeScript, Node 22+, pnpm, ESM. Coordination through `@band-ai/sdk`. Findings and verdicts are validated with `zod`. Model calls go through a provider-agnostic `ModelClient` (`openai` SDK for the AIML gateway, `@anthropic-ai/bedrock-sdk`, `@google/genai`).

## Quickstart (no API keys)

The full debate runs end to end on an in-process fake transport, so you can see it work without any keys or a Band account:

```bash
pnpm install
pnpm test         # 11 tests across 8 files, fake transport + routing, no keys
pnpm typecheck
pnpm local        # full board debating the sample asset on the fake transport
```

## Run on real band.ai

1. Create one External agent per role in app.band.ai. Copy `.env.example` to `.env` and paste each agent's UUID and API key.
2. Pick a provider: set `AIML_API_KEY` with `MODEL_MODE=aiml`, or use `MODEL_MODE=dev` with AWS and GCP credentials (and `FEATHERLESS_API_KEY` for the open-model LATAM reviewer).
3. `pnpm agents` to connect the agents. Then in a Band room, add the agents and a human, and post a marketing asset that @mentions the coordinator.

## Repo layout

```
src/
  agents/    coordinator, region + brand reviewers, reconcile, remediation
  band/      band.ai transport (real) and an in-process fake for tests
  domain/    asset / rulebook / finding types and loaders
  models/    ModelClient interface, per-provider adapters, MODEL_MODE routing
  run/       local demo, real-agent runner, connection + model smoke tests
assets/      brand DNA, per-region rulebooks, sample assets
docs/        AIML switchover guide
test/        walking-skeleton rungs, full-board, remediation, routing
```

## Submission

Band of Agents Hackathon, deadline June 19, 2026, 10:00 AM CST.

- Hosted demo: TODO
- Application URL: TODO
- Slide deck: TODO
- Video walkthrough: TODO

## License

MIT. See `LICENSE`.
