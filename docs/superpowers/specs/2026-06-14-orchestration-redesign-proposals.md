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

## Proposal 4: The Blackboard, federated into pods on a decision spine

Metaphor: an editorial floor. Specialists do not each shout at one board. They work in small pods (local pipelines) that deliberate among themselves, then file one consolidated finding to a shared board. A decision spine then moves the asset from intake to a terminal verdict. This keeps the blackboard's strength (a shared context many agents reason over) but adds local structure, real agent-to-agent debate, clear movement, and a definite end. (Blackboard AI architecture, but federated into pods on a spine.)

A flat board where every agent posts straight to the center has no movement, no real flow, and no clear final state. Pods fix that: they create local discussion before anything reaches the board, and the spine gives the whole run a direction and a terminus.

### Structure: pods, then the board, then a decision spine
- Pods (local pipelines, where the discussions happen). Each pod is a small cluster that passes work agent to agent and debates before emitting one consolidated finding.
  - Claims pod: Scout, Claim & Evidence, Precedent Librarian. Extracts claims, tests substantiation, attaches prior rulings, then files a claim dossier.
  - Regulatory pod (the debate): US, EU, and LATAM argue the dossier against their rulebooks and against each other, then file their verdicts plus the specific cross-region conflict.
  - Brand pod: Brand Voice, Channel Fit, Visual settle on-voice and hook constraints, then file a brand-fit note.
- The board (reconciliation). Pods post here; this is where cross-pod conflict becomes visible (Regulatory says cut, Brand says the claim is the hook). The Mediator, Disclosure Drafter, and Remediation operate at the board to resolve it.
- The decision spine (movement and a final state). The asset travels intake, to pods, to board, to the Risk Adjudicator, which drives a terminal verdict: published, spiked, or escalated to the human then ruled. One explicit loop (remediate and recommit) sends a revised asset back through the pods. There is no ambiguous, never-ending board.

The Conductor sequences which pod or agent acts next; the Risk Adjudicator owns the decision and is the only path to the human.

The roster below is the cast that fills these pods. Adding an agent is just adding a trigger and a model to a pod, so the cast is cheap to grow.

### The cast (knowledge sources)

| Agent | Tier | Wakes when the board shows | Posts to the board | Model |
|---|---|---|---|---|
| Scout | scout | a new or revised asset | claims, spans, surfaces, work-items | Featherless small (open) |
| Claim & Evidence | review | a factual or efficacy claim | supported, or unsupported + needs-source | Gemini Pro |
| US Regulatory (FTC) | review | a claim on a US-targeted asset | pass or block + rule cite | Claude Sonnet |
| EU Regulatory + GDPR | review | a claim or data-capture CTA on an EU asset | pass or block + rule cite | Gemini Pro |
| LATAM Regulatory | review | a LATAM target is in scope (added on demand) | pass or block + rule cite | Featherless (cross-framework) |
| Brand Voice | review | any copy span | on-voice or off-voice + forbidden phrasing | Claude Haiku |
| Channel Fit | review | the channel and format are known | hook, length, format notes | Gemini Flash |
| Visual / Image | review | an image is present or was regenerated | visual compliance + brand fit | AIML multimodal |
| Disclosure Drafter | specialist | an annotation says a claim needs a disclosure | the exact required disclosure text | Claude Sonnet |
| Precedent Librarian | specialist | a claim or a clash appears | matching past rulings + rulebook entries | Gemini Flash + retrieval |
| Mediator | resolver | two annotations disagree on the same span | a proposed resolution | Claude Opus |
| Remediation | resolver | a fixable block | a revised draft + a regenerated image | Sonnet + Nano Banana (AIML) |
| Conductor | control | more than one knowledge source is eligible | which source acts next (arbitration only) | Gemini Flash |
| Risk Adjudicator | control | the board state changed | publishable, needs-human, or deadlocked | Claude Opus |
| Marketing Lead | human | the adjudicator summons on deadlock or high risk | a ruling that folds into the rulebook | human |

That is thirteen specialist agents plus a human, each a different lens, several on different models and at least one on a different framework. The minimum-of-three requirement is cleared many times over, and the multi-model and cross-framework judging lines are covered by the roster itself.

### Control without a hub
The risk with a blackboard is that the controller becomes a hidden orchestrator that does all the thinking. This design splits control so that does not happen:
- Agents self-subscribe to board predicates (their trigger column). They are not told what to do; they wake themselves when the board matches.
- The Conductor only arbitrates contention. When several sources are eligible at once it picks an order, so it is a traffic cop, not a decision maker.
- The Risk Adjudicator is the only agent that can summon the human, and it does so from a board-wide risk score, not from a single finding.

No single agent reviews the content; coordination is a property of the board state plus many small triggers.

### A conflict cascade (how the cast comes alive)
1. Scout posts the claim "boost your immune system" and its spans.
2. Claim & Evidence flags it unsupported and asks for a source.
3. US Regulatory passes (the mock RCT file substantiates it); EU Regulatory blocks on Article 10(2). The board now holds a clash on the same span.
4. The clash wakes the Mediator, which drafts a resolution.
5. The Precedent Librarian injects a past ruling on the word "boost" to bias the resolution.
6. The Disclosure Drafter writes the exact Article 10(2) accompanying statement.
7. Remediation rewrites the span and regenerates the image (Nano Banana), posts the revised draft, which re-wakes the Scout.
8. The Risk Adjudicator sees EU still blocked, scores the board deadlocked, and summons the Marketing Lead.
9. The human rules; the ruling folds into the rulebook, so the next "boost" never climbs this far.

Conflict is the engine of the whole cascade: the clash is what pulls the mediator, precedent, disclosure, and remediation agents in.

### Why it is not scatter-gather
Two reasons. Inside a pod, agents debate each other before anything reaches the board, so there is local pipeline structure and genuine agent-to-agent discussion, not blind parallel posting. Across the system, the decision spine carries the asset from intake to a terminal verdict, so there is clear direction and a defined end, not a flat hub. The board is a shared reconciliation surface, not an orchestrator.

### Band primitives it leans on
The room is the board; `getChatContext` rehydrates board state for any waking agent. `sendEvent` posts an annotation or a work-item (visible reasoning). A waking agent is brought in via `addParticipant` and a directed @mention; `lookupPeers` lets the Conductor see who can be woken. LATAM Regulatory is added with `addParticipant` only when a LATAM target is in scope (dynamic recruitment on camera).

### Build approach (high effort, but cheap per agent)
Build the knowledge-source framework once: a uniform agent shell of (trigger predicate, read board via context, one model call, post annotation), plus a Conductor loop that reads board state and arbitrates eligible sources, plus the Risk Adjudicator scoring. After that, each new agent is config: a trigger, a prompt, a model, and (for reviewers) a rulebook. The existing parameterized `region-reviewer` is already most of a knowledge source, so the regional agents port over quickly. The real work is the board state model and the Conductor, replacing `makeCoordinator`'s broadcast.

### Tradeoffs
The most agents, the most "agents discover the work," and the richest demo cast. Risk: emergent order is the least predictable on video, so for the demo the Scout should seed a known asset and the Conductor should cap how many sources fire per tick, to keep the run legible in two to three minutes. The board state model is the hardest single piece to get right.

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
