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

---

## Proposal 4: The Blackboard

Metaphor: experts around a shared whiteboard. Whoever has something relevant to the current state of the board speaks next. Order emerges from content, not from a fixed graph. (This is the classic blackboard AI architecture, and the Band room is the blackboard.)

### Shape
No fan-out. A lightweight Controller inspects the board (the asset plus accumulated annotations) and, each step, wakes the single agent whose trigger condition best matches the current state:
- Board has a raw asset, so wake the specialist who owns the highest-risk surface.
- Board now carries "EU: disease-claim flag on span X," so wake the disclosure specialist for span X.
- Board now shows brand and EU annotations conflicting on span X, so wake the mediator.
- Board reaches a stable disagreement, so wake the human.

### Why it is not scatter-gather
Conflict is a board state that triggers the mediator, so the system reacts to disagreement as it emerges rather than running a fixed pass. It is the most "agents discover the work" of any pattern here.

### Band primitives it leans on
The room is the blackboard; `getChatContext` rehydrates board state for any waking agent. `sendEvent` is the act of posting an annotation. The Controller uses `addParticipant` and a directed @mention to wake the chosen agent.

### Multi-model fit
Controller on a cheap fast router model (Gemini Flash) making the "who acts next" call, specialists on assorted models, mediator on Opus.

### Build delta (high)
The biggest rework: replace the parallel fan-out with a Controller scheduler loop that selects the next agent from board state, and make agents reactive (each gets a trigger predicate). New controller logic in place of `makeCoordinator`'s broadcast.

### Tradeoffs
Most architecturally novel and the strongest "emergent coordination" story. Risk: emergent order is the least predictable on video and the hardest to keep demo-stable in a 2 to 3 minute run, and the Controller can become a hidden single point of orchestration if it is too prescriptive.

---

## Proposal 5: Shuttle Diplomacy

Metaphor: Camp David. The two camps in deepest tension (US "ship if substantiated" and EU "pre-authorize plus disclose") never speak directly; a Mediator carries concrete proposals back and forth until convergence or a declared impasse.

### Shape
A pendulum, not a fan.
1. Both camps state positions to the Mediator, not to each other.
2. The Mediator forms one concrete proposal (change wording to X, add disclosure Y, keep the hook in the caption) and shuttles it to camp A.
3. A accepts or counters; the Mediator carries the delta to camp B; B accepts or counters; back to A. Each shuttle narrows the gap.
4. Convergence publishes the brokered draft. Repeated non-movement is declared an impasse and goes to the human with the full shuttle record showing exactly which clause neither side would move. Brand sits as a constraint the Mediator must respect (the hook cannot die).

### Why it is not scatter-gather
The whole structure exists to resolve one genuine bilateral conflict through directed, alternating exchange. There is no broadcast and no aggregation step.

### Band primitives it leans on
Directed @mentions are the shuttle (Mediator to A, Mediator to B). `sendEvent` shows the current proposal and the narrowing gap. `addParticipant` brings in the human on impasse.

### Multi-model fit
Mediator on Opus (the hard reasoning), camps on Gemini Pro and Sonnet, the brand constraint on Haiku.

### Build delta (medium)
Reconcile becomes a shuttle loop (alternating directed messages plus a convergence-or-impasse detector) instead of a one-shot flag-merge. Reuses the existing reviewers as the two camps.

### Tradeoffs
The cleanest single-conflict story and very legible visually (a pendulum closing a gap). Risk: it models one bilateral conflict well but is awkward when three or more mandates clash at once, so it scales worse than the Table.

---

## Comparison

| Pattern | Centers conflict via | Best judging line | Build effort | Demo-stability |
|---|---|---|---|---|
| 1 Negotiation Table | directed offers / counters over a mutating draft | Originality | Medium | Medium (needs round cap) |
| 2 Courtroom | objection then rebuttal then ruling | Presentation | Low to medium | High |
| 3 Escalation Ladder | conflict gates promotion upward | Business value | Medium to high | Medium |
| 4 Blackboard | conflict is a state that wakes the mediator | Application of tech | High | Low |
| 5 Shuttle Diplomacy | alternating bilateral proposals | Originality | Medium | High |

## Recommendation: a hybrid (Ladder shell, Negotiation Table core, Courtroom framing)

No single pattern maximizes all four judging lines, but they compose cleanly. The recommended build:

1. Outer shell is the Escalation Ladder. Triage (Featherless, cheap) marks risky spans, specialists examine only those spans, and conflict gates work upward. This carries the business-value and multi-model-routing stories and keeps cheap paths cheap.
2. The negotiation rung is the Negotiation Table. When a span gates upward, agents exchange directed offers and counteroffers over that contested span, the artifact mutates, a conflict ledger tracks open items, and a stable deadlock is detected. This delivers the genuine agent-to-agent negotiation the brief promises and the current code fakes.
3. The negotiation rung wears Courtroom framing for legibility. Each turn is an "objection plus remedy" or a "rebuttal," the Chair is a "judge," and the human is the "higher court." This makes the debate readable on video without narration.

### Why this hybrid wins
It fixes all four baseline problems at once: directed negotiation becomes the center (not a boolean), the human is reached only on an observed stable deadlock (earned escalation), Band's enforced directed routing is used rather than wasted, and the topology no longer looks like map-reduce. Every judging line gets a concrete hook: Application (directed handoffs plus summon-on-conflict), Business value (cost-gated tiers), Originality (agents argue over a mutating artifact and form or break deals), Presentation (a courtroom-legible deadlock then a human ruling).

### Build delta, all on existing seams
1. Add a Triage agent (Featherless) plus a span-gating step before specialists. Touches the fan-out at `coordinator.ts:77`.
2. Replace `decideRegion()` flag-merge with a round-based negotiation loop in the Chair, with a conflict ledger and a stable-deadlock detector. Touches `reconcile.ts:67` to `:91`.
3. Add `negotiateWith` to `makeRegionReviewer` so an objection is directed at brand and carries a remedy; let brand ACCEPT / COUNTER / HOLD. Touches `region-reviewer.ts:53`.
4. Turn remediation into "apply the accepted remedy to the draft" so the artifact mutates, and re-review only the changed span. Touches `remediation.ts:27`.
5. Summon the human via `addParticipant` only on a stable deadlock; fold the ruling into the rulebook as precedent (partly present already).

## Band primitive mapping (shared by all proposals)

| Primitive | Role in the redesign |
|---|---|
| `sendMessage(content, mentions)` | The directed-argument channel. Band requires at least one @mention to route, so objections, counters, rebuttals, and shuttles all use it. This is the primitive the baseline wastes. |
| `sendEvent(content, type, metadata)` | Visible reasoning and audit: each agent's private rationale, the conflict ledger, the docket, the narrowing gap. Makes the debate legible to judges without pinging everyone. |
| `addParticipant` / `removeParticipant` | Dynamic recruitment: summon the next tier, the mediator, or the human exactly when conflict requires it. |
| `lookupPeers` (gate on `capabilities.peers`) | Discover who can be summoned (used by the Ladder and Blackboard controllers). |
| `getChatContext` | Rehydrate room state for a waking agent (the blackboard read). |

## Next step
Pick a direction from the deck. Once chosen, this exploration doc graduates into an updated design spec and an implementation plan (writing-plans), and the build proceeds on the existing seams listed above.
