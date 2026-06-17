# Architecture

## Shape
A Band room (the "review board") where specialist reviewer agents with competing objectives review a marketing content asset, debate and reconcile a verdict, and drive the asset to a terminal state: published, sent back for revision, or escalated to a human. It is a negotiation, not a linear pipeline. The originality lives in the conflict: the reviewers must negotiate a tradeoff, not just run checks in sequence.

The system runs two coexisting topologies on the same domain and the same Band coordination layer:

- **Pods** (the live showcase): blackboard pods on a decision spine. Three specialist pods deliberate in parallel on a shared board, file consolidated findings, and a deterministic spine drives the asset to a terminal decision. Run with `pnpm agents` (or `pnpm agents:classic` is the other cast, below).
- **Classic** (the lighter coexisting path): a flat reviewer cast that emits per-region verdicts for the web portal's per-material "Run review". Lighter, faster, and the only cast that emits the per-region verdict events the dashboard renders.

Both run on `MODEL_MODE=vertex` (all agents on Gemini via Vertex, one GCP credential, no AIML key and no AWS / Bedrock).

## The headline: blackboard pods on a decision spine
Three deliberation **pods** feed a shared **board**, and a decision **spine** ends in a terminal state. The spine (Conductor, the pod leads, and the Risk Adjudicator) is deterministic and does NOT call a model, so the routing and the verdict are fully auditable. The leaf agents (pod members, the Mediator, and Remediation) call models. This split is deliberate: the judgement that decides the outcome is reproducible, while the language work that needs a model is pushed to the leaves.

### The pods
Each pod has a **lead** that delegates the asset to its members, collects their findings, and files ONE consolidated `PodFinding` (with any conflicts it found) to the board. Pods adapt to a partial roster: a lead only waits for the members present when the asset arrived, so the cast still works under a room participant cap.

- **Claims pod** (Claims Lead + Scout, Claim & Evidence, Precedent, Disclosure).
  - Scout maps the risky surfaces of the asset.
  - Claim & Evidence flags claims unsupported by the asset's own evidence.
  - Precedent attaches relevant prior rulings.
  - Disclosure drafts mandatory disclosure text.
- **Regulatory pod** (Reg Lead + US, EU, LATAM reviewers). Each reviewer reviews its own region's rulebook.
- **Brand pod** (Brand Lead + Brand Voice, Channel Fit, Visual). Tone, channel suitability, and imagery.

### The genuine conflict (the originality)
When regions clash on a claim, the **Regulatory pod runs a ONE-ROUND rebuttal**. The Reg Lead challenges each blocking region with the peer's argument, and each region either **holds** its block or **concedes**, judged on its own rulebook. This is real agent-to-agent disagreement resolved by argument, not a silent merge or a majority vote. The pod files the surviving conflicts to the board.

### The board
- **Mediator.** Brokers cross-pod conflicts into the smallest resolution that satisfies every mandate, or reports a deadlock when there is no such resolution.
- **Remediation.** Once the human approves a fix, rewrites the blocked copy and regenerates a localized, on-brand image, posts the rewritten copy and the new image link into the room, then recommits the revised asset for re-review. This closes a real bidirectional loop, not a one-shot pass.

### The spine (deterministic, no model calls)
- **Conductor.** Fans the asset out to the three pods and owns the single Remediation recommit. The only agent a human tags.
- **Pod leads.** Delegate to members, collect findings, file one consolidated PodFinding each.
- **Risk Adjudicator.** Scores the board, surfaces what is blocking and asks the human to approve a fix or reject, runs the approved mediation / remediation cycle, and drives the terminal decision: **published**, **spiked**, or **escalated**.

### The flow (intake to terminal)
1. A human posts the asset and @mentions the **Conductor**.
2. The Conductor fans the asset out to the 3 pods.
3. Each pod lead delegates to its members, who file findings.
4. The Regulatory pod debates conflicts via the one-round rebuttal (hold / concede).
5. Each pod files one consolidated PodFinding (with its conflicts) to the board.
6. The **Risk Adjudicator** scores. On a cross-pod conflict it consults the **Mediator** for the smallest resolution.
7. If anything still blocks, the Adjudicator does NOT fix it silently: it posts a full **report** (every flagged claim, by reviewer, with the rule, reason, and required disclosure) and asks permission to fix it.
8. On the human's **yes**:
   - If one shared compliant version is possible, ONE **Remediation** pass (rewrite + regenerate image) posts the new copy + image link and recommits for a re-review.
   - If the markets collide irreconcilably (a span one market bans but another allows), Remediation produces **one market-tailored version per market** and the campaign **publishes per-market** (passing markets ship the original). This is the localization payoff of the "legal in the US, a violation in the EU" thesis: no lowest-common-denominator version.
   On **reject**, the asset is spiked.
9. If a shared rewrite still blocks after the recommit cap, escalate the deadlock to the human for a final ruling.
10. Terminal: a single **published** / **spiked**, or a **per-market** publish. At every terminal (and the ask) the Adjudicator posts the **final report** as the last word, so the verdict, the rules violated, the fixes, and material links are never buried.

## When the human enters (the permission gate and escalation, not every asset)
- The permission gate: before any fix, the Adjudicator surfaces what is blocking and asks the human to approve the rewrite (yes) or spike it (reject).
- A genuine deadlock the agents cannot reconcile, even after the approved Remediation recommit.
- A hard legal or claim violation over a risk threshold.
- Low reviewer confidence.

The human is the **Compliance Lead**: a participant, not an agent. The human's ruling on an escalated item is **logged as precedent that feeds future reviews** (the Claims pod's Precedent member attaches relevant prior rulings on later assets). This is how the system learns precedent rather than re-litigating the same call.

## The lighter coexisting path: classic
A flat cast kept for fast per-region verdicts driven from the web portal:

> Coordinator to US / EU / LATAM / Brand reviewers to **Reconcile** to per-region verdicts

- **Coordinator** intakes the asset and dispatches it to the reviewers.
- **US / EU / LATAM / Brand reviewers** review in parallel and post structured findings (each with severity and rationale).
- **Reconcile** gathers the findings, detects conflicts between the competing objectives, negotiates a resolution, and emits the **per-region verdicts** the dashboard renders.
- **Remediation** rewrites and regenerates on a revise verdict, then loops back for re-review.

Only Reconcile emits per-region verdict events, so this cast (not the pods cast, which files PodFindings and one terminal decision) is what backs the web portal's per-material campaign **Run review** button. It is the lighter, secondary topology that coexists with the pods showcase.

## Shared context: the brand DNA and the workspace
A structured representation of a brand that every reviewer reads from the room's shared context: voice and tone descriptors, approved and forbidden vocabulary, claim boundaries (what can be said, what needs a source), and channel norms (format, length, hook conventions per platform). This is the intelligence the agents coordinate around. Human decisions on escalated items fold back as precedent so the system learns over time.

Do not depend on Band enterprise "Memories" (gated). Shared context lives in task-scoped rooms, shared workspace files, and the `/context` rehydration endpoint.

## Model routing (multi-model by design, single mode for the live run)
Each agent maps to a model chosen to match its job. For the live run everything is on **`MODEL_MODE=vertex`**: every model-calling agent runs on Gemini via Vertex, so the whole flow works on one GCP credential with no AIML key and no AWS / Bedrock. Perception (vision + STT) falls back to Vertex when no AIML key is set.

The deterministic spine (Conductor, pod leads, Risk Adjudicator) calls no model at all, so the showcase routing is auditable: only the leaves (pod members, Mediator, Remediation) consume model calls. The original multi-model intent is preserved as a routing target:
- Reconcile and careful reasoning: a strong frontier model (for example Claude, via Bedrock for volume).
- Structured review (for example claim and legal): a frontier model via AIML API.
- One or two reviewers on open-source models via Featherless (targets the Featherless prize).
- Image regeneration in Remediation: Nano Banana via AIML API (the multimodal showcase that targets the AIML prize).
- Use GCP credits (Gemini) and Bedrock credits (Claude) for volume so the small AIML credit is spent only on the high-visibility showcase calls.

A development mode (`MODEL_MODE=dev`) routes some agents (US / Brand / Remediation) to Bedrock and needs AWS credentials. Use `MODEL_MODE=vertex` when you only have a GCP credential.

## Band usage rules (from the hackathon)
- Minimum 3 agents collaborating through Band. Both casts exceed this.
- Band must be the actual collaboration layer, not a thin wrapper, final notification system, or output channel. The review, the one-round rebuttal, the cross-pod mediation, the handoffs, and the escalation all happen through Band.
- Cross-framework is encouraged. Running agents on different frameworks in the same room is a differentiator and maps to the "collaborate across frameworks" criterion. Confirm which Band adapters are live before committing.
- Do not depend on enterprise "Memories." Use task-scoped rooms, shared workspace files, and the `/context` rehydration endpoint for shared context.
