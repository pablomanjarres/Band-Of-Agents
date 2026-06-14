# Orchestration Redesign: Proposals

Status: exploration, 2026-06-14. Companion visual deck: `orchestration-proposals.html` (gitignored, not committed). Builds on `docs/superpowers/specs/2026-06-13-multi-region-review-board-design.md`. Repo writing rule: no em dashes.

## Why this document exists

The brief sells one thing as the win condition: "the reviewers hold competing mandates in genuine tension and must adjudicate a real tradeoff, not merge a list of flags. If the agents only pass output down a line, the project loses." The current orchestration does not deliver that. It is a scatter-gather (map-reduce) topology, and the part that is supposed to be a negotiation is a deterministic flag-merge. This document proposes orchestration shapes that put conflict, negotiation, and escalation into the structure itself.

## What the code actually does today (the baseline, honestly)

Traced from the `band-review-board` branch:

- Topology: `context -> coordinator -[broadcast]-> {US, EU, BRAND, LATAM} -[all @reconcile]-> reconcile -> {publish | remediation -> re-intake | human}`.
- The coordinator broadcasts the asset to every reviewer at once (`coordinator.ts:77`). Reviewers run in parallel, each a single model call against its own rulebook (`region-reviewer.ts:61`).
- Reviewers never address each other. Every reviewer is hardwired to report to `@reconcile` (`reportToHandle: '@reconcile'`, `session.ts:93`). There is no reviewer-to-reviewer message anywhere.
- "Reconcile" is not an LLM negotiation. It is deterministic aggregation: it waits for all regions, runs `decideRegion()` if/else logic per region (`reconcile.ts:135`), and computes conflict as a boolean: `conflict = canPublish.length > 0 && blocked.length > 0` (`reconcile.ts:81`).
- The re-review loop is capped at one round (`MAX_REMEDIATION_ROUNDS = 1`, `reconcile.ts:35`); a second unresolved adapt is forced to escalate.

### Why this is the wrong shape for this project

1. The originality is asserted in prose but absent from the structure. The topology (start small, fan out, fan in, end small) is identical to every generic multi-agent demo. A judge looking at the graph sees map-reduce.
2. The negotiation does not exist. The brief promises "agents negotiate a tradeoff, not merge a list of flags." The code literally merges a list of flags with a boolean. The single most important differentiator is the one thing that is faked.
3. It wastes Band's defining primitive. `sendMessage` requires at least one @mention to route, which means Band structurally rewards directed, agent-to-agent communication. Pointing every arrow at one reconcile node throws that away and uses Band as a collector, which is close to the "thin wrapper / final notification" usage the hackathon rules call out.
4. Escalation is not earned. The human is reached by a counter hitting a cap, not by a genuine, observed deadlock between agents.

The proposals below each fix these four problems in a different way. They share a visual language (see the deck) and all build on the existing seams: `makeCoordinator` (fan-out), `makeRegionReviewer` (routing), `makeReconcile` / `decideRegion` (verdict logic), `makeRemediation` (loop closure).

---

## Proposal 1: The Negotiation Table

Metaphor: a bargaining table. The asset draft is the object on the table, and it visibly mutates as deals are struck.

### Shape
Round-based, not a fan. The draft sits in the room as shared context. Each round:
1. Every reviewer with an objection posts a directed challenge to the draft's owner (brand), and the objection must carry a concrete remedy (the price of clearance). Example: `@brand the span "boost your immune system" trips EU Art 10(2); I clear it if you (a) change to "contributes to normal immune function" and (b) add the balanced-diet statement.`
2. The owner responds to each remedy directionally: ACCEPT (mutate the draft), COUNTER (`@eu I will take the wording change, but the disclosure kills the hook; can it live in the caption, not the headline?`), or HOLD (declare a red line).
3. A Chair maintains an explicit conflict ledger: open conflicts are remedies not yet accepted. When the ledger drains, the converged draft publishes. When a conflict survives N rounds unchanged with both sides at a red line, that specific span escalates to the human as a stable deadlock.

### Why it is not scatter-gather
The negotiation is literal and directed: agents argue with each other, the artifact evolves in view, and deadlock is detected as "this exact conflict did not move," not "two verdicts differ." Conflict is the engine, not a boolean side effect.

### Band primitives it leans on
`sendMessage` + @mention is the offer / counteroffer channel, which is exactly what Band enforces. `sendEvent` posts each agent's private reasoning and the live ledger so the debate is legible to judges. `addParticipant` summons the human on deadlock.

### Multi-model fit
Brand on a fast model (Haiku) for many quick voice calls, EU on Gemini Pro, US on Sonnet, Chair on Opus (tracks the ledger and rules on deadlock). The cheap models do the back-and-forth; the expensive Chair is spent only on deadlock.

### Build delta (medium)
Replace `decideRegion()` flag-merge with a round loop in the Chair; add a `negotiateWith` option to `makeRegionReviewer` so an objection is directed at brand and carries a remedy; make brand able to ACCEPT / COUNTER / HOLD; turn remediation into "apply the accepted remedy to the draft" so the artifact mutates; add the ledger plus a stable-deadlock detector (same conflict id unchanged across rounds). Reuses every existing agent.

### Tradeoffs
Strongest direct hit on the win condition (genuine negotiation over a mutating artifact). Risk: rounds can wander, so the Chair needs a firm round cap and a crisp deadlock rule to stay demo-stable.

---

## Proposal 2: The Courtroom

Metaphor: a hearing. Compliance sign-off is quasi-legal, so this fits the domain and reads instantly on video.

### Shape
Turn-structured, not parallel. Roles: Advocate (brand, argues to ship as written), Challengers (US and EU, each counsel for its jurisdiction, file objections citing the rulebook as case law), Judge (reconcile, a strong model), Clerk (coordinator, maintains the docket), Higher Court (the human, reached only on appeal). Phases:
1. Filing: the Advocate enters the asset plus its evidence (the two-RCT substantiation file).
2. Objections: each Challenger files objections directed at the Advocate, each citing a rule, a span, and a severity.
3. Cross-examination: the Advocate rebuts each objection directly (`@eu my evidence is RCT-grade, does the Article 14 risk-reduction path not apply?`); the Challenger sustains or withdraws; the Judge may question either side.
4. Ruling: the Judge rules per objection (sustained / overruled) to yield a per-region verdict. Sustained but curable becomes a remand to remediation; sustained, incurable, and contested escalates to the Higher Court with the full trial record.

### Why it is not scatter-gather
The adversarial structure is the product. Rebuttal and cross-examination are genuine directed exchange, and the human inherits a real record rather than a flag count.

### Band primitives it leans on
Directed @mentions carry objection then rebuttal between specific parties. `sendEvent` posts the Judge's reasoning and the docket. `addParticipant` summons the Higher Court.

### Multi-model fit
Judge on Opus (authority), Advocate on Sonnet (persuasion), EU on Gemini Pro, US on Sonnet or Haiku. Natural home for a cross-framework move: put one Challenger on a LangGraph adapter as "opposing counsel from another firm."

### Build delta (low to medium)
Mostly role and phase sequencing over existing agents. The reviewers become Advocate and Challengers (prompt changes plus a rebuttal turn); reconcile becomes the Judge issuing per-objection rulings (the per-objection verdict can stay deterministic while the cross-examination round is an LLM exchange). Reuses every agent.

### Tradeoffs
Best presentation value: a judge can follow it without narration, and the deadlock-to-appeal moment is dramatic. Risk: the theater can feel scripted if the rebuttals are shallow, so the cross-examination prompts must let a Challenger genuinely change its position.

---

## Proposal 3: The Escalation Ladder

Metaphor: a real org's sign-off chain. Cheap fast checks at the bottom, only genuine conflict climbs, the human is the top rung and is reached rarely.

### Shape
Vertical, not a fan. Conflict is the gate that promotes work upward.
- Rung 0, Triage (a small open-source model via Featherless): scans the whole asset and marks candidate-risky spans. Clean assets exit here, cheaply.
- Rung 1, Specialists: examine only the flagged spans, not the whole asset and not all at once. If the specialists agree (all clear, or one shared fix), the item resolves with no negotiation.
- Rung 2, Negotiation: fires only on inter-specialist conflict. The contested span enters a bounded negotiation (the Table from Proposal 1, scoped to that one span).
- Rung 3, Human: reached only on a stable deadlock. The ruling folds back into the rulebook as precedent, so that span does not climb again.

### Why it is not scatter-gather
There is no broadcast. Each rung is summoned only when the rung below could not resolve, so conflict drives the topology upward rather than every agent firing on every asset.

### Band primitives it leans on
`lookupPeers` plus `addParticipant` summon the next rung on demand, so agents literally appear as conflict escalates (agents discovering each other and dividing work, a judging line). `sendEvent` shows each promotion decision; directed @mention hands the contested span to the summoned tier.

### Multi-model fit
The cleanest routing story of the set: Featherless small model at the bottom (targets the Featherless prize), Haiku or Gemini Flash for specialists, Sonnet or Opus for negotiation, the human at the top. Cost scales with difficulty.

### Build delta (medium to high)
Add a Triage agent and a span-gating step; turn the coordinator from a broadcaster into a promoter that summons tiers via `addParticipant` on conflict; reuse the existing reviewers as the specialist rung and the Table as the negotiation rung. This is a real change to the fan-out at `coordinator.ts:77`.

### Tradeoffs
Best business-value story (most content never touches the expensive board) and the most idiomatic multi-model routing. Risk: on the single hand-picked demo asset the cheap rungs add steps before the money-shot conflict, so the demo script must start near the top or use an asset that climbs fast.
