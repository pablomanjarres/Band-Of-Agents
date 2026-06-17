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
3. Each pod reviews and files findings. The Regulatory pod debates conflicts via a one-round rebuttal (hold / concede).
4. Each pod files one consolidated finding (with its conflicts) to the board.
5. The **Risk Adjudicator** scores. On a cross-pod conflict it consults the **Mediator**.
6. If anything still blocks, the Adjudicator does NOT fix it silently. It posts a full **report** (every flagged claim, by reviewer, with the rule it cites, the reason, and any required disclosure) and ASKS PERMISSION to fix it.
7. The human replies **"yes"**:
   - **One shared version possible** (the markets do not fundamentally collide): ONE **Remediation** pass rewrites the blocked copy, regenerates an on-brand image, posts the new copy + image link, and recommits for a re-review.
   - **Markets collide irreconcilably** (a span one market bans but another allows, e.g. a substantiated "clinically proven" claim the US permits with a disclosure but the EU bans): Remediation produces **one market-tailored version per market** (each with its own copy + image link). Passing markets ship the original; blocking markets ship their tailored version. The campaign **publishes per-market**.
8. The human replies **"reject"**: the campaign is spiked.
9. If a shared rewrite still blocks after the recommit cap, the Adjudicator escalates the deadlock to the human for a final ruling.
10. Terminal: a single **published** / **spiked**, or a **per-market** publish (US / EU / LATAM versions).
11. At every terminal (and the permission ask) the Adjudicator posts the **final report** as the last word, so the verdict, the rules violated, the fixes, and the material links are never buried mid-thread. A clean campaign publishes with a "no findings" report rather than a bare "0 findings".

The report is also published as an **artifact** and each report message leads with `Full report (rendered, with images): <app>/a/<id>`, a clickable link that opens in the **deployed dashboard** (the artifact-viewer SPA renders it by kind). The `pnpm agents` runner POSTs the report to the backend (`REPORT_BACKEND`, default the Cloud Run service) and the promo images to `POST /api/images`, so the link and the images resolve from anywhere, not just the machine running the agents. `PUBLIC_BASE_URL` (default `https://artifact-viewer-one.vercel.app`) is the origin used in the links. If the backend is unreachable it falls back to a local viewer on `http://localhost:8788`.

Example room lines you will see:

```
Conductor: Reviewing the "VitaBoost Focus Q3" campaign for US, EU, LATAM plus brand. Pods, please run your reviews.
Claims Reviewer: claims pod filed: 3 finding(s), 0 conflict(s): "clinically proven to boost your immune system" is unsubstantiated...
EU Reviewer rebuts on 'clinically proven...': hold
Reg Lead: regulatory pod filed: 4 finding(s), 1 conflict(s).
Risk Adjudicator: 1 conflict(s), consulting mediator
Mediator: no movement
Adjudicator -> @compliance-lead: here is what is blocking publication:
  - BLOCK "9 out of 10 users felt healthier": testimonial efficacy claim without substantiation
  - CONFLICT "clinically proven to boost your immune system": blocked by EU, passed by US
  Want me to fix these claims and regenerate the promo image? Reply "yes" to remediate, or "reject" to spike.
Compliance Lead: yes
Remediation: Here are the proposed fixes: "Support your everyday wellness with VitaBoost Focus..."
  New promotional image: http://localhost:8788/api/images/<id>.png
Risk Adjudicator: PUBLISHED   (or: deadlock after remediation, escalating)
```

### How to run

```
MODEL_MODE=vertex pnpm agents
```

By default this connects the **compact 10-agent cast** to band.ai (Claims and Brand are single reviewers; the Regulatory pod keeps its US/EU/LATAM debate), so it fits a 14-agent room. Each connected agent needs its own `PREFIX_AGENT_ID` / `PREFIX_API_KEY` in `.env`. The 10 prefixes used: `CONDUCTOR`, `CLAIMS_LEAD` (the solo Claims Reviewer), `REG_LEAD`, `US`, `EU`, `LATAM`, `BRAND_LEAD` (the solo Brand Reviewer), `MEDIATOR`, `REMEDIATION`, `ADJUDICATOR`. (The full 17-agent cast adds `SCOUT`, `CLAIM_EVIDENCE`, `PRECEDENT`, `DISCLOSURE`, `BRAND_VOICE`, `CHANNEL`, `VISUAL`; drop `compact` in `src/run/agents.ts` to use it.)

Then in `app.band.ai`:

1. Create a room.
2. Add the 10 agents plus yourself as the human reviewer (the Compliance Lead): Conductor, Risk Adjudicator, Claims Reviewer, Reg Lead, US Reviewer, EU Reviewer, LATAM Reviewer, Brand Reviewer, Mediator, Remediation.
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
