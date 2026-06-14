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
