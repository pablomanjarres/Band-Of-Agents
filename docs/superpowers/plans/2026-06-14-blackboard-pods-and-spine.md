# Blackboard Pods and Spine: Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scatter-gather orchestration (coordinator broadcasts to parallel reviewers, a deterministic reconcile flag-merges) with deliberation pods that debate internally, a shared board that reconciles cross-pod conflict, and a decision spine that drives the asset to a terminal verdict.

**Architecture:** Three pods (Claims, Regulatory, Brand) are small local pipelines of knowledge-source agents that talk to each other through Band before each files one consolidated `PodFinding` to the board. A Conductor sequences the pods. At the board a Mediator, Disclosure Drafter, and the existing Remediation agent resolve conflict. A Risk Adjudicator reads the accumulated findings and drives a terminal decision: publish, spike, escalate to the human, or remediate-and-recommit (one loop). Every agent is an `AgentHandler` reacting to directed `@mention` messages on a `BandTransport`, so Band is the real collaboration layer. Pod-leads and the Adjudicator use the same closure-accumulator pattern the existing `makeReconcile` already uses (collect by key, act when all expected inputs arrive).

**Tech Stack:** TypeScript, Node 22+, ESM, Zod schemas (`src/domain`), `@band-ai/sdk` via the `BandTransport` seam (`FakeBandTransport` for tests, `RealBandTransport` for Band Cloud), provider-agnostic `ModelClient` with `MODEL_MODE` routing (`src/models/route.ts`), Vitest. No em dashes in any committed text.

---

## Scope

This plan delivers the new orchestration end to end on the `FakeBandTransport` with deterministic tests (Phases 0 to 5). That is working, testable software on its own: the full pods -> board -> spine flow, the Regulatory debate, the human escalation, and the terminal states all run and assert under `pnpm test`. Phase 6 (the web live-board diagram) is included as a final, lighter phase because the research confirmed it is isolated to `web/src/pipeline.ts` and `web/src/components/PipelineDiagram.tsx`. Real Band Cloud wiring is Phase 5 and reuses the identical agent handlers behind `RealBandTransport`.

Design reference: `docs/superpowers/specs/2026-06-14-orchestration-redesign-proposals.md`, Proposal 4 ("The Blackboard, federated into pods on a decision spine").

## Message protocol (who @mentions whom, and the payload)

Every payload is JSON in the message `content`; visible reasoning goes through `sendEvent`. Handles follow the existing convention (`@coordinator`, `@reconcile`, ...). New handles: `@conductor`, `@scout`, `@claim-evidence`, `@precedent`, `@claims-lead`, `@reg-lead`, `@brand-lead`, `@channel`, `@visual`, `@mediator`, `@disclosure`, `@adjudicator`, plus reused `@us-reviewer`, `@eu-reviewer`, `@latam-reviewer`, `@brand-reviewer`, `@remediation`, and the human `@compliance-lead`.

1. Intake: the user/intake posts the `ContentAsset` JSON, mentioning `@conductor`.
2. Conductor posts `sendEvent('intake', ...)`, then `@mention`s the three pod-leads (`@claims-lead`, `@reg-lead`, `@brand-lead`) with the asset. It records which pods it expects back.
3. Each pod-lead `@mention`s its members with the asset (Claims: `@scout` then `@claim-evidence` then `@precedent`; Regulatory: `@us-reviewer`, `@eu-reviewer`, `@latam-reviewer`; Brand: `@brand-reviewer`, `@channel`, `@visual`).
4. Members reply to the pod-lead with a `Position` (or `Finding[]`). In the Regulatory pod, when two members block/pass the same span, they exchange one directed rebuttal round (member `@mention`s the peer) before the lead consolidates. This is the genuine debate.
5. Each pod-lead consolidates and posts one `PodFinding` JSON to `@adjudicator` (and `sendEvent('pod-finding', ...)`).
6. Adjudicator accumulates `PodFinding`s (closure Map keyed by roomId, expects 3). On a conflict it `@mention`s `@mediator`; the Mediator may `@mention` `@disclosure` (for required text) or `@remediation` (for a rewrite), then posts a `mediation` result back to `@adjudicator`.
7. Adjudicator scores the board and emits an `AdjudicatorDecision`:
   - `publish` -> `sendEvent('terminal', { decision: 'published' })`, status complete.
   - `spike` -> `sendEvent('terminal', { decision: 'spiked' })`, status complete.
   - `remediate` -> `@mention`s `@remediation`; the revised asset re-enters at the Conductor (the one loop), capped at `MAX_RECOMMITS = 1`.
   - `escalate` -> `@mention`s the human `@compliance-lead`; the human ruling folds into the rulebook (`logPrecedent`) and re-triggers adjudication.

## Multi-model routing

`src/models/route.ts` gains roles for every new agent. Cheap models do the high-volume pod chatter; expensive models do reconciliation and the decision. New `AgentRole` entries (added to the existing `coordinator|us|eu|latam|brand|reconcile|remediation`): `conductor`, `scout`, `claim`, `precedent`, `channel`, `visual`, `disclosure`, `mediator`, `adjudicator`. Suggested mapping in Task 5.1.

## File structure

**New files**
- `src/domain/board.ts` — Zod schemas: `WorkItem`, `Position`, `ConflictItem`, `PodFinding`, `AdjudicatorDecision`, `TerminalDecision`, plus JSON-schema constants for model calls.
- `src/agents/knowledge-source.ts` — `makeKnowledgeSource(opts)`: the generic reviewer shell (parse asset, one `model.complete` with a JSON schema, post `Finding[]`/`Position` to a `reportToHandle`). The Claims and Brand pod members and the board specialists are all configs over this shell.
- `src/agents/pod-lead.ts` — `makePodLead(opts)`: collects member positions (closure Map), runs the optional one-round rebuttal on conflict, consolidates, and files one `PodFinding`.
- `src/agents/conductor.ts` — `makeConductor(opts)`: intake fan to pod-leads, tracks recommits.
- `src/agents/mediator.ts` — `makeMediator(opts)`: wakes on a conflict, optionally pulls disclosure/remediation, posts a mediation result.
- `src/agents/risk-adjudicator.ts` — `makeRiskAdjudicator(opts)`: accumulates `PodFinding`s, scores, emits terminal/escalate/remediate.
- `src/board/pod-session.ts` — `PodBoardSession`: wires the new topology on a `BandTransport` (mirrors `BoardSession`'s structure).

**Modified files**
- `src/agents/region-reviewer.ts` — add an optional `debate` capability: when it receives a peer-challenge message it replies hold/concede; default behavior unchanged.
- `src/agents/brand-reviewer.ts` — `reportToHandle` points at `@brand-lead` (wiring only).
- `src/models/route.ts` — add the new roles to `AgentRole` and `ROUTES`.
- `src/board/events.ts` — extend `BoardEvent` with `workitem`, `position`, `debate`, `pod-finding`, `mediation`, `adjudication`, `terminal`; extend `translateActivity`.
- `src/run/local.ts` — build and run the new `PodBoardSession` on the fake transport.
- `src/run/agents.ts` — same wiring behind `RealBandTransport` (Phase 5).

**Reused as-is**
- `src/band/*` (transport seam, fake + real), `src/models/*` (ModelClient, providers), `src/agents/remediation.ts`, `src/agents/handles.ts` (`matchParticipant`), `src/store/store.ts`, `src/domain/types.ts` (`Finding`, `ContentAsset`, `Rulebook`, `RegionVerdict`).

**Web (Phase 6)**
- `web/src/pipeline.ts` (rewrite `NodeId`/`EdgeId` + `buildPipelineModel`), `web/src/components/PipelineDiagram.tsx` (render pods + board + spine). `boardState.ts`, `api.ts`, `LiveBoardPage.tsx` need no change (event folding and SSE are topology-agnostic).

---
