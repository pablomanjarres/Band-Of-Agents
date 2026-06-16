# Running the live Band.ai review

This system runs a real multi-agent review on band.ai. The headline workflow is **blackboard pods on a decision spine** ("pods" for short): three specialist pods deliberate in parallel on a shared blackboard, file consolidated findings to a board, and a deterministic spine drives the asset to a terminal decision. Run it with `pnpm agents`.

A lighter **classic** cast is kept as a secondary path for fast per-region verdicts driven from the web portal. See the second half of this doc.

## Pods: the real live Band workflow

### Why this is the showcase

The originality is in the conflict, not the pipeline. The reviewer agents have competing objectives and must negotiate a tradeoff: the regulatory pod debates a one-round rebuttal, the board brokers cross-pod conflicts into the smallest resolution that satisfies every mandate, and only a genuine deadlock escalates to a human. The spine (Conductor + pod leads + Risk Adjudicator) is deterministic and does not call a model, so every verdict is auditable.

### The cast (17 agents + the human)

- **Conductor.** Fans the asset out to the three pods. Owns the single remediation recommit. The only agent a human tags.
- **Claims pod** (Claims Lead + 4 members):
  - **Scout.** Maps the risky surfaces of the asset.
  - **Claim & Evidence.** Flags claims unsupported by the asset's own evidence.
  - **Precedent.** Attaches relevant prior rulings.
  - **Disclosure.** Drafts mandatory disclosure text.
- **Regulatory pod** (Reg Lead + 3 reviewers):
  - **US, EU, LATAM reviewers.** Each reviews its region's rulebook. On a conflict the Reg Lead runs a ONE-ROUND rebuttal: each blocking region either holds its block or concedes.
- **Brand pod** (Brand Lead + 3 members):
  - **Brand Voice, Channel Fit, Visual.** Review tone, channel suitability, and imagery.
- **Board:**
  - **Mediator.** Brokers cross-pod conflicts into the smallest resolution that satisfies every mandate, or reports a deadlock.
  - **Remediation.** Rewrites blocked copy and regenerates a localized, on-brand image, then recommits the revised asset.
- **Risk Adjudicator.** Scores the board, runs the mediation/remediation cycle, and drives the terminal decision (published / spiked / escalated). Part of the deterministic spine, so it does not call a model.
- **Compliance Lead = the human.** Rules a genuine deadlock. The ruling is logged as precedent.

### The flow (intake to terminal)

1. A human posts the asset and @mentions the **Conductor**.
2. The Conductor fans out to the 3 pods.
3. Each pod lead delegates to its members, who file findings.
4. The Regulatory pod debates conflicts via the one-round rebuttal (hold / concede).
5. Each pod files one consolidated finding (with its conflicts) to the board.
6. The **Risk Adjudicator** scores. On a conflict it consults the **Mediator**.
7. If unresolved, ONE **Remediation** recommit (rewrite + regenerate image) sends the revised asset back through the Conductor for a re-review.
8. If still unresolved after the recommit cap, escalate to the human.
9. Terminal: **published** or **spiked**.

Example room lines you will see:

```
Conductor: Reviewing the campaign for US, EU, LATAM plus brand. Pods, please run your reviews.
Claims Lead: claims pod deliberating (4 members)
EU Reviewer rebuts on 'clinically proven...': hold
Reg Lead: regulatory pod filed: 8 findings, 3 conflicts
Risk Adjudicator: 3 conflicts, consulting mediator
Mediator: no movement
Adjudicator: remediate (attempt 1)
Adjudicator: deadlock, escalating
```

### How to run

```
MODEL_MODE=vertex pnpm agents
```

This connects the 17-agent cast to band.ai and keeps the process alive. Each agent needs its own `PREFIX_AGENT_ID` / `PREFIX_API_KEY` in `.env` (one prefix per role: `CONDUCTOR`, `CLAIMS_LEAD`, `SCOUT`, `CLAIM_EVIDENCE`, `PRECEDENT`, `DISCLOSURE`, `REG_LEAD`, `US`, `EU`, `LATAM`, `BRAND_LEAD`, `BRAND_VOICE`, `CHANNEL`, `VISUAL`, `MEDIATOR`, `REMEDIATION`, `ADJUDICATOR`).

Then in `app.band.ai`:

1. Create a room.
2. Add the agents plus the human reviewer.
3. Post `@Conductor review <campaign name>`.

`MODEL_MODE=vertex` routes every agent through Gemini on Vertex: one GCP credential, no AIML key, no AWS / Bedrock.

## Models: run everything on Vertex

In `MODEL_MODE=dev`, some agents (US / Brand / Remediation) route to Bedrock, which needs AWS credentials. If you only have a GCP credential, use **`MODEL_MODE=vertex`**: every agent runs on Gemini via Vertex, so the whole flow works on one credential, no AIML key and no AWS. (Perception, vision + STT, already falls back to Vertex when no AIML key is set.)

## Classic: the lighter per-region path (secondary)

The classic cast is a lighter topology:

> Coordinator to US / EU / LATAM / Brand reviewers to **Reconcile**

Only **Reconcile** emits the **per-region verdicts** the web dashboard renders, so this is what the portal's **Run review** button uses for a fast per-region verdict. (The pods cast files pod findings and one terminal decision, not per-region verdict events, so the per-region dashboard view is driven by the classic cast.)

The classic agents need their credentials in `.env`: `COORDINATOR`, `US`, `EU`, `LATAM`, `BRAND`, `RECONCILE`, `REMEDIATION`, `INTAKE` (each `_AGENT_ID` and `_API_KEY`), plus `GOOGLE_GENAI_USE_VERTEXAI=true` and `GOOGLE_CLOUD_PROJECT`.

### Web-driven (recommended for the dashboard)

```
MODEL_MODE=vertex pnpm serve:band
```

The server connects the classic cast AND serves the portal. Open a campaign, click **Run review**, and the per-material verdicts stream back to the page as the agents reconcile in their band.ai rooms.

### Manual (in app.band.ai)

```
MODEL_MODE=vertex pnpm agents:classic
```

Then in app.band.ai: create a room, add the connected agents plus the human reviewer, and post `Coordinator, review campaign <name>`. Reconcile posts the verdicts back into the room.
