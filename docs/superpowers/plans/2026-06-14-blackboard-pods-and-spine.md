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

## Phase 0: Domain types for the board

### Task 0.1: Board Zod schemas

**Files:**
- Create: `src/domain/board.ts`
- Test: `test/board-types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/board-types.test.ts
import { describe, expect, it } from 'vitest';
import {
  WorkItem, ScoutOutput, ConflictItem, PodFinding, AdjudicatorDecision,
  MediationResult, TerminalDecision,
} from '../src/domain/board';

describe('board domain schemas', () => {
  it('parses a Scout work-item list', () => {
    const out = ScoutOutput.parse({
      workItems: [{ id: 'w1', kind: 'claim', text: 'boost your immune system', surfaces: ['headline'] }],
    });
    expect(out.workItems[0].kind).toBe('claim');
  });

  it('defaults surfaces and conflicts to empty arrays', () => {
    expect(WorkItem.parse({ id: 'w1', kind: 'cta', text: 'sign up' }).surfaces).toEqual([]);
    const pf = PodFinding.parse({ kind: 'pod-finding', pod: 'regulatory', summary: 's', findings: [] });
    expect(pf.conflicts).toEqual([]);
  });

  it('models a cross-region conflict', () => {
    const c = ConflictItem.parse({ span: 'boost', blockedBy: ['EU'], passedBy: ['US'] });
    expect(c.blockedBy).toContain('EU');
    expect(c.rationale).toBe('');
  });

  it('parses an adjudicator decision and terminal enum', () => {
    const d = AdjudicatorDecision.parse({ kind: 'adjudication', decision: 'escalate', score: 0.2, rationale: 'deadlock' });
    expect(d.decision).toBe('escalate');
    expect(TerminalDecision.parse('spiked')).toBe('spiked');
    expect(MediationResult.parse({ kind: 'mediation', resolved: false, note: 'no movement' }).requiredDisclosure).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/board-types.test.ts`
Expected: FAIL, cannot resolve `../src/domain/board`.

- [ ] **Step 3: Implement `src/domain/board.ts`**

```typescript
// src/domain/board.ts
// Schemas for the pods -> board -> spine orchestration. Reuses Finding from types.ts.
import { z } from 'zod';
import { Finding } from './types';

// A unit of risky surface the Scout extracts for pods to work on.
export const WorkItem = z.object({
  id: z.string(),
  kind: z.enum(['claim', 'copy-span', 'image', 'cta']),
  text: z.string(),
  surfaces: z.array(z.string()).default([]),
});
export type WorkItem = z.infer<typeof WorkItem>;

export const ScoutOutput = z.object({ workItems: z.array(WorkItem) });
export type ScoutOutput = z.infer<typeof ScoutOutput>;

// A disagreement on one span: who blocked it, who passed it.
export const ConflictItem = z.object({
  span: z.string(),
  blockedBy: z.array(z.string()),
  passedBy: z.array(z.string()),
  rationale: z.string().default(''),
});
export type ConflictItem = z.infer<typeof ConflictItem>;

// The single consolidated finding a pod files to the board.
export const PodFinding = z.object({
  kind: z.literal('pod-finding'),
  pod: z.enum(['claims', 'regulatory', 'brand']),
  summary: z.string(),
  findings: z.array(Finding),
  conflicts: z.array(ConflictItem).default([]),
});
export type PodFinding = z.infer<typeof PodFinding>;

// The Mediator's attempt to resolve a conflict at the board.
export const MediationResult = z.object({
  kind: z.literal('mediation'),
  resolved: z.boolean(),
  note: z.string(),
  requiredDisclosure: z.string().nullable().default(null),
});
export type MediationResult = z.infer<typeof MediationResult>;

// The Risk Adjudicator's decision that drives the spine.
export const AdjudicatorDecision = z.object({
  kind: z.literal('adjudication'),
  decision: z.enum(['publish', 'spike', 'remediate', 'escalate']),
  score: z.number().min(0).max(1),
  rationale: z.string(),
  unresolved: z.array(ConflictItem).default([]),
});
export type AdjudicatorDecision = z.infer<typeof AdjudicatorDecision>;

// Terminal states the spine ends in.
export const TerminalDecision = z.enum(['published', 'spiked', 'escalated']);
export type TerminalDecision = z.infer<typeof TerminalDecision>;

// JSON Schema constants passed to model.complete({ jsonSchema }) for LLM agents.
export const SCOUT_OUTPUT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    workItems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', enum: ['claim', 'copy-span', 'image', 'cta'] },
          text: { type: 'string' },
          surfaces: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'kind', 'text'],
      },
    },
  },
  required: ['workItems'],
} as const;

export const MEDIATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    resolved: { type: 'boolean' },
    note: { type: 'string' },
    requiredDisclosure: { type: ['string', 'null'] },
  },
  required: ['resolved', 'note'],
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/board-types.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/board.ts test/board-types.test.ts
git commit -m "feat(domain): board schemas (work-items, pod findings, conflicts, adjudication)"
```

---

## Phase 1: The pods (knowledge-source shell, pod-lead, the Regulatory debate)

### Task 1.1: Generic knowledge-source agent shell

The Claims and Brand pod members and the board specialists are all the same shape: parse the asset, one model call with a JSON schema, post the result to a pod-lead. Write that shell once.

**Files:**
- Create: `src/agents/knowledge-source.ts`
- Test: `test/knowledge-source.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/knowledge-source.test.ts
import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { makeKnowledgeSource } from '../src/agents/knowledge-source';
import { StubModelClient } from '../src/models/client';

const ASSET = JSON.stringify({ id: 'a1', channel: 'instagram', markets: ['US'], copy: 'c', claim: 'boost immunity' });

describe('knowledge source shell', () => {
  it('reviews the asset and reports findings to its pod lead', async () => {
    const room = new FakeBandTransport('r');
    const model = new StubModelClient(() => ({ text: '', json: { findings: [{ category: 'claim', severity: 'warn', claim: 'boost immunity', rationale: 'unsupported' }] } }));
    await room.connectAgent({ agentId: 'lead', name: 'Claims Lead', handle: '@claims-lead', onMessage: async () => {} });
    await room.connectAgent({
      agentId: 'ce', name: 'Claim & Evidence', handle: '@claim-evidence',
      onMessage: makeKnowledgeSource({ role: 'claim-evidence', reviewerName: 'Claim & Evidence', system: 'sys', jsonSchema: {}, model, reportToHandle: '@claims-lead' }),
    });
    room.post('lead', ASSET, [{ id: 'ce' }]);
    await room.drain();
    const reply = room.transcript.find((t) => t.fromId === 'ce' && t.kind === 'message');
    expect(reply).toBeTruthy();
    const payload = JSON.parse(reply!.content);
    expect(payload.source).toBe('claim-evidence');
    expect(payload.findings[0].severity).toBe('warn');
    expect(reply!.mentions.some((m) => m.id === 'lead')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/knowledge-source.test.ts`
Expected: FAIL, cannot resolve `../src/agents/knowledge-source`.

- [ ] **Step 3: Implement `src/agents/knowledge-source.ts`**

```typescript
// src/agents/knowledge-source.ts
import type { AgentHandler } from '../band/types';
import type { ModelClient } from '../models/client';
import type { ContentAsset } from '../domain/types';
import { matchParticipant } from './handles';
import { tryParseAsset } from '../domain/load';

export interface KnowledgeSourceOptions {
  role: string;                                  // stable key, e.g. 'claim-evidence'
  reviewerName: string;                          // display name in events
  system: string;                                // system prompt
  jsonSchema: unknown;                           // output schema for model.complete
  model: ModelClient;
  reportToHandle: string;                        // pod-lead handle, e.g. '@claims-lead'
  eventType?: string;                            // sendEvent type, default 'review'
  buildUser?: (asset: ContentAsset) => string;   // default: pretty JSON of the asset
  ignoreFromHandle?: string;                     // optional: skip messages from this handle
}

export function makeKnowledgeSource(opts: KnowledgeSourceOptions): AgentHandler {
  const eventType = opts.eventType ?? 'review';
  return async (message, tools) => {
    if (opts.ignoreFromHandle && message.senderName && message.senderName.includes(opts.ignoreFromHandle.replace('@', ''))) return;
    const asset = tryParseAsset(message.content);
    if (!asset) return;
    const user = opts.buildUser ? opts.buildUser(asset) : `Asset (JSON):\n${JSON.stringify(asset, null, 2)}`;
    const res = await opts.model.complete({ system: opts.system, messages: [{ role: 'user', content: user }], jsonSchema: opts.jsonSchema });
    const payload = (res.json && typeof res.json === 'object') ? (res.json as Record<string, unknown>) : {};
    await tools.sendEvent(`${opts.reviewerName} reviewed ${asset.id}`, eventType, { role: opts.role });
    const target = matchParticipant(await tools.getParticipants(), opts.reportToHandle, 'agent');
    if (target) {
      await tools.sendMessage(JSON.stringify({ source: opts.role, asset: asset.id, ...payload }), [{ id: target.id, handle: target.handle }]);
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/knowledge-source.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agents/knowledge-source.ts test/knowledge-source.test.ts
git commit -m "feat(agents): generic knowledge-source shell (parse asset, one model call, report to pod lead)"
```

### Task 1.2: Region reviewer gains a one-round rebuttal (the debate)

Add a debate branch to the existing reviewer so a pod-lead can challenge it with a peer's argument and it replies hold or concede. Default behavior (a fresh asset) is unchanged.

**Files:**
- Modify: `src/agents/region-reviewer.ts` (add a challenge branch at the top of the handler)
- Test: `test/region-debate.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/region-debate.test.ts
import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { makeRegionReviewer } from '../src/agents/region-reviewer';
import { StubModelClient } from '../src/models/client';
import { loadBrandDna, loadRulebook } from '../src/domain/load';

const ASSETS = new URL('../assets/', import.meta.url).pathname;
const challenge = JSON.stringify({ kind: 'challenge', claim: 'boost', peerRegion: 'US', peerRationale: 'substantiated by RCT' });

describe('region reviewer debate', () => {
  it('answers a peer challenge with a hold/concede rebuttal addressed to the pod lead', async () => {
    const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
    const eu = loadRulebook(`${ASSETS}rulebook.eu.json`);
    const model = new StubModelClient(() => ({ text: '', json: { stance: 'hold', rationale: 'Article 10(2) still applies' } }));
    const room = new FakeBandTransport('r');
    await room.connectAgent({ agentId: 'lead', name: 'Reg Lead', handle: '@reg-lead', onMessage: async () => {} });
    await room.connectAgent({
      agentId: 'eu', name: 'EU Reviewer', handle: '@eu-reviewer',
      onMessage: makeRegionReviewer({ region: 'EU', reviewerName: 'EU Reviewer', rulebook: eu, brand, model, reportToHandle: '@reg-lead' }),
    });
    room.post('lead', challenge, [{ id: 'eu' }]);
    await room.drain();
    const reply = room.transcript.find((t) => t.fromId === 'eu' && t.kind === 'message');
    const payload = JSON.parse(reply!.content);
    expect(payload.kind).toBe('rebuttal');
    expect(payload.region).toBe('EU');
    expect(payload.stance).toBe('hold');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/region-debate.test.ts`
Expected: FAIL (the reviewer ignores a challenge message because it is not an asset).

- [ ] **Step 3: Add the challenge branch to `src/agents/region-reviewer.ts`**

Add this constant near the top of the file (after imports):

```typescript
const REBUTTAL_JSON_SCHEMA = {
  type: 'object',
  properties: {
    stance: { type: 'string', enum: ['hold', 'concede'] },
    rationale: { type: 'string' },
  },
  required: ['stance', 'rationale'],
} as const;
```

Inside `makeRegionReviewer`, at the very start of the returned handler (before the existing asset-parsing logic), insert:

```typescript
    // Debate branch: a pod lead relays a peer's argument; we hold or concede.
    let challenge: { kind?: string; claim?: string; peerRegion?: string; peerRationale?: string } | null = null;
    try { challenge = JSON.parse(message.content); } catch { challenge = null; }
    if (challenge && challenge.kind === 'challenge') {
      const res = await opts.model.complete({
        system: `You are the ${opts.region} reviewer. A peer (${challenge.peerRegion}) argues: "${challenge.peerRationale}". Decide whether to hold your block on "${challenge.claim}" under the ${opts.region} rulebook, or concede. Answer JSON.`,
        messages: [{ role: 'user', content: `Claim under dispute: ${challenge.claim}` }],
        jsonSchema: REBUTTAL_JSON_SCHEMA,
      });
      const out = (res.json ?? {}) as { stance?: string; rationale?: string };
      const target = matchParticipant(await tools.getParticipants(), opts.reportToHandle ?? '', 'agent') ?? null;
      const mention = target ? [{ id: target.id, handle: target.handle }] : [{ id: message.senderId }];
      await tools.sendEvent(`${opts.reviewerName} rebuts on "${challenge.claim}": ${out.stance ?? 'hold'}`, 'debate', { region: opts.region });
      await tools.sendMessage(JSON.stringify({ kind: 'rebuttal', region: opts.region, claim: challenge.claim, stance: out.stance ?? 'hold', rationale: out.rationale ?? '' }), mention);
      return;
    }
```

(`matchParticipant` is already imported in this file; confirm the import line `import { matchParticipant } from './handles';` is present, it is used by the existing report path.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/region-debate.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite to confirm no regression**

Run: `pnpm test`
Expected: PASS (existing tests still green; the challenge branch only triggers on `kind: 'challenge'`).

- [ ] **Step 6: Commit**

```bash
git add src/agents/region-reviewer.ts test/region-debate.test.ts
git commit -m "feat(agents): region reviewer answers peer challenges (one-round rebuttal)"
```

### Task 1.3: The pod-lead (collect, debate on conflict, consolidate)

**Files:**
- Create: `src/agents/pod-lead.ts`
- Test: `test/pod-lead.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/pod-lead.test.ts
import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { makePodLead } from '../src/agents/pod-lead';

const review = (region: string, severity: 'block' | 'warn' | 'info', claim = 'boost') =>
  JSON.stringify({ region, reviewer: `${region} Reviewer`, findings: [{ category: 'claim', severity, claim, rationale: 'r' }] });

describe('pod lead', () => {
  it('files one PodFinding to the adjudicator once all members report, flagging the cross-region conflict', async () => {
    const room = new FakeBandTransport('r');
    const filed: string[] = [];
    await room.connectAgent({ agentId: 'adj', name: 'Adjudicator', handle: '@adjudicator', onMessage: async (m) => { filed.push(m.content); } });
    await room.connectAgent({
      agentId: 'lead', name: 'Reg Lead', handle: '@reg-lead',
      onMessage: makePodLead({ pod: 'regulatory', members: ['@us-reviewer', '@eu-reviewer'], memberKeys: ['US', 'EU'], reportToHandle: '@adjudicator', debate: false }),
    });
    // US passes (info), EU blocks the same span -> conflict
    room.post('us', review('US', 'info'), [{ id: 'lead' }]);
    room.post('eu', review('EU', 'block'), [{ id: 'lead' }]);
    await room.drain();
    expect(filed).toHaveLength(1);
    const pf = JSON.parse(filed[0]);
    expect(pf.kind).toBe('pod-finding');
    expect(pf.pod).toBe('regulatory');
    expect(pf.conflicts[0].span).toBe('boost');
    expect(pf.conflicts[0].blockedBy).toContain('EU');
    expect(pf.conflicts[0].passedBy).toContain('US');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/pod-lead.test.ts`
Expected: FAIL, cannot resolve `../src/agents/pod-lead`.

- [ ] **Step 3: Implement `src/agents/pod-lead.ts`**

```typescript
// src/agents/pod-lead.ts
import type { AgentHandler, RoomTools } from '../band/types';
import type { Finding } from '../domain/types';
import type { ConflictItem, PodFinding } from '../domain/board';
import { matchParticipant } from './handles';
import { tryParseAsset } from '../domain/load';

export interface PodLeadOptions {
  pod: 'claims' | 'regulatory' | 'brand';
  members: string[];        // member handles to dispatch the asset to
  memberKeys: string[];     // expected reply keys (region or source) to wait for
  reportToHandle: string;   // '@adjudicator'
  debate?: boolean;         // run a one-round rebuttal when a conflict is detected
}

interface MemberReply { key: string; findings: Finding[] }

export function makePodLead(opts: PodLeadOptions): AgentHandler {
  // Per-room accumulation, mirroring makeReconcile's collected-Map pattern.
  const replies = new Map<string, Map<string, MemberReply>>();
  const debated = new Set<string>();

  const detectConflicts = (all: MemberReply[]): ConflictItem[] => {
    const byClaim = new Map<string, { blockedBy: string[]; passedBy: string[]; rationale: string }>();
    for (const r of all) {
      const blockedClaims = new Set(r.findings.filter((f) => f.severity === 'block').map((f) => f.claim));
      const seen = new Set<string>();
      for (const f of r.findings) {
        if (seen.has(f.claim)) continue;
        seen.add(f.claim);
        const entry = byClaim.get(f.claim) ?? { blockedBy: [], passedBy: [], rationale: '' };
        if (blockedClaims.has(f.claim)) { entry.blockedBy.push(r.key); entry.rationale = f.rationale; }
        else entry.passedBy.push(r.key);
        byClaim.set(f.claim, entry);
      }
      // Members with no finding on a blocked claim count as passing it.
    }
    // A claim blocked by some members and not by others is a conflict.
    const conflicts: ConflictItem[] = [];
    for (const [span, e] of byClaim) {
      const passedBy = opts.memberKeys.filter((k) => !e.blockedBy.includes(k));
      if (e.blockedBy.length > 0 && passedBy.length > 0) {
        conflicts.push({ span, blockedBy: e.blockedBy, passedBy, rationale: e.rationale });
      }
    }
    return conflicts;
  };

  const consolidateAndFile = async (roomId: string, tools: RoomTools): Promise<void> => {
    const map = replies.get(roomId);
    if (!map) return;
    const all = [...map.values()];
    const findings = all.flatMap((r) => r.findings);
    const conflicts = detectConflicts(all);
    const pf: PodFinding = {
      kind: 'pod-finding',
      pod: opts.pod,
      summary: `${opts.pod} pod: ${findings.length} findings, ${conflicts.length} conflict(s)`,
      findings,
      conflicts,
    };
    await tools.sendEvent(pf.summary, 'pod-finding', { pod: opts.pod, conflicts: conflicts.length });
    const target = matchParticipant(await tools.getParticipants(), opts.reportToHandle, 'agent');
    if (target) await tools.sendMessage(JSON.stringify(pf), [{ id: target.id, handle: target.handle }]);
    replies.delete(roomId);
    debated.delete(roomId);
  };

  return async (message, tools) => {
    const roomId = message.roomId;

    // 1) Asset from the conductor: dispatch to members.
    const asset = tryParseAsset(message.content);
    if (asset) {
      replies.set(roomId, new Map());
      const participants = await tools.getParticipants();
      for (const handle of opts.members) {
        const t = matchParticipant(participants, handle, 'agent');
        if (t) await tools.sendMessage(JSON.stringify(asset), [{ id: t.id, handle: t.handle }]);
      }
      await tools.sendEvent(`${opts.pod} pod deliberating (${opts.members.length} members)`, 'recruited', { pod: opts.pod });
      return;
    }

    // 2) A member reply (review result, rebuttal) or noise.
    let body: Record<string, unknown> | null = null;
    try { body = JSON.parse(message.content); } catch { return; }
    if (!body) return;

    const map = replies.get(roomId) ?? new Map<string, MemberReply>();
    replies.set(roomId, map);

    if (body.kind === 'rebuttal') {
      const key = String(body.region ?? '');
      const prev = map.get(key);
      // concede drops the block to a warn so it no longer conflicts.
      if (prev && body.stance === 'concede') {
        prev.findings = prev.findings.map((f) => (f.claim === body.claim && f.severity === 'block' ? { ...f, severity: 'warn' as const } : f));
      }
      map.set(`${key}:rebut`, { key: `${key}:rebut`, findings: [] }); // mark received
    } else {
      const key = String(body.region ?? body.source ?? '');
      const findings = (Array.isArray(body.findings) ? body.findings : []) as Finding[];
      map.set(key, { key, findings });
    }

    // 3) All initial members in?
    const haveAll = opts.memberKeys.every((k) => map.has(k));
    if (!haveAll) return;

    const initial = opts.memberKeys.map((k) => map.get(k)!).filter(Boolean);
    const conflicts = detectConflicts(initial);

    // 4) Optional one rebuttal round on conflict.
    if (opts.debate && conflicts.length > 0 && !debated.has(roomId)) {
      debated.add(roomId);
      const participants = await tools.getParticipants();
      for (const c of conflicts) {
        for (const region of c.blockedBy) {
          const handle = `@${region.toLowerCase()}-reviewer`;
          const t = matchParticipant(participants, handle, 'agent');
          if (t) await tools.sendMessage(JSON.stringify({ kind: 'challenge', claim: c.span, peerRegion: c.passedBy[0], peerRationale: 'peer passes this span' }), [{ id: t.id, handle: t.handle }]);
        }
      }
      return; // wait for rebuttals, then this handler re-fires and re-evaluates
    }

    // 5) Consolidate and file.
    await consolidateAndFile(roomId, tools);
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/pod-lead.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agents/pod-lead.ts test/pod-lead.test.ts
git commit -m "feat(agents): pod-lead collects member positions, runs rebuttal on conflict, files one PodFinding"
```

### Task 1.4: Regulatory pod end-to-end debate (integration)

Prove US + EU + LATAM + a debating lead produce a single conflict-bearing PodFinding on the fake transport.

**Files:**
- Test: `test/regulatory-pod.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// test/regulatory-pod.test.ts
import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { makePodLead } from '../src/agents/pod-lead';
import { makeRegionReviewer } from '../src/agents/region-reviewer';
import { StubModelClient } from '../src/models/client';
import { loadAsset, loadBrandDna, loadRulebook } from '../src/domain/load';

const ASSETS = new URL('../assets/', import.meta.url).pathname;

describe('regulatory pod debate', () => {
  it('US passes, EU holds a block on rebuttal, pod files a conflict', async () => {
    const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
    const usRules = loadRulebook(`${ASSETS}rulebook.us.json`);
    const euRules = loadRulebook(`${ASSETS}rulebook.eu.json`);
    const latamRules = loadRulebook(`${ASSETS}rulebook.latam.json`);
    const asset = loadAsset(`${ASSETS}sample-asset.json`);
    const claim = asset.claim;

    const pass = new StubModelClient(() => ({ text: '', json: { findings: [{ category: 'claim', severity: 'info', claim, rationale: 'substantiated' }] } }));
    const block = new StubModelClient(() => ({ text: '', json: { findings: [{ category: 'claim', severity: 'block', claim, rationale: 'Article 10(2)' }] } }));
    const hold = new StubModelClient(() => ({ text: '', json: { stance: 'hold', rationale: 'still unlawful' } }));
    // EU model returns a block on review, and a hold on rebuttal. Use a counter.
    let euCall = 0;
    const euModel = new StubModelClient(() => (euCall++ === 0 ? { text: '', json: { findings: [{ category: 'claim', severity: 'block', claim, rationale: 'Article 10(2)' }] } } : { text: '', json: { stance: 'hold', rationale: 'still unlawful' } }));

    const filed: string[] = [];
    const room = new FakeBandTransport('r');
    await room.connectAgent({ agentId: 'adj', name: 'Adjudicator', handle: '@adjudicator', onMessage: async (m) => { filed.push(m.content); } });
    await room.connectAgent({ agentId: 'reglead', name: 'Reg Lead', handle: '@reg-lead', onMessage: makePodLead({ pod: 'regulatory', members: ['@us-reviewer', '@eu-reviewer', '@latam-reviewer'], memberKeys: ['US', 'EU', 'LATAM'], reportToHandle: '@adjudicator', debate: true }) });
    await room.connectAgent({ agentId: 'us', name: 'US Reviewer', handle: '@us-reviewer', onMessage: makeRegionReviewer({ region: 'US', reviewerName: 'US Reviewer', rulebook: usRules, brand, model: pass, reportToHandle: '@reg-lead' }) });
    await room.connectAgent({ agentId: 'eu', name: 'EU Reviewer', handle: '@eu-reviewer', onMessage: makeRegionReviewer({ region: 'EU', reviewerName: 'EU Reviewer', rulebook: euRules, brand, model: euModel, reportToHandle: '@reg-lead' }) });
    await room.connectAgent({ agentId: 'latam', name: 'LATAM Reviewer', handle: '@latam-reviewer', onMessage: makeRegionReviewer({ region: 'LATAM', reviewerName: 'LATAM Reviewer', rulebook: latamRules, brand, model: pass, reportToHandle: '@reg-lead' }) });

    room.post('cond', JSON.stringify(asset), [{ id: 'reglead' }]);
    await room.drain();

    expect(filed).toHaveLength(1);
    const pf = JSON.parse(filed[0]);
    expect(pf.conflicts.length).toBeGreaterThan(0);
    expect(pf.conflicts[0].blockedBy).toContain('EU');
    // the debate happened: EU was challenged and held
    const debate = room.transcript.find((t) => t.kind === 'event' && (t.content ?? '').includes('rebuts'));
    expect(debate).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm vitest run test/regulatory-pod.test.ts`
Expected: PASS. If the rebuttal mark-received bookkeeping prevents re-consolidation, adjust `makePodLead` step 4/5 so that after the rebuttal replies arrive the handler reaches `consolidateAndFile` (the `debated` set guard ensures the challenge round runs once, then the next member message triggers consolidation).

- [ ] **Step 3: Commit**

```bash
git add test/regulatory-pod.test.ts
git commit -m "test(agents): regulatory pod produces a single conflict-bearing PodFinding through a debate"
```

> **MVP note:** within the Claims and Brand pods, members run concurrently and the pod-lead consolidates (the pod boundary and consolidation are real; the genuine agent-to-agent exchange is the Regulatory rebuttal round). Sequential intra-pod pipelines (Scout seeds work-items, then peers consume them) are a later enhancement and are not required for the win condition.

---

## Phase 2: Claims and Brand pod members

### Task 2.1: Pod member configs over the knowledge-source shell

**Files:**
- Create: `src/agents/pod-members.ts`
- Test: `test/claims-pod.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/claims-pod.test.ts
import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { makePodLead } from '../src/agents/pod-lead';
import { makeScout, makeClaimEvidence, makePrecedent, makeDisclosure } from '../src/agents/pod-members';
import { StubModelClient } from '../src/models/client';
import { loadAsset } from '../src/domain/load';

const ASSETS = new URL('../assets/', import.meta.url).pathname;

describe('claims pod', () => {
  it('files one claims PodFinding carrying the unsupported-claim finding', async () => {
    const asset = loadAsset(`${ASSETS}sample-asset.json`);
    const scout = new StubModelClient(() => ({ text: '', json: { workItems: [{ id: 'w1', kind: 'claim', text: asset.claim, surfaces: ['headline'] }] } }));
    const ce = new StubModelClient(() => ({ text: '', json: { findings: [{ category: 'claim', severity: 'warn', claim: asset.claim, rationale: 'needs a source' }] } }));
    const prec = new StubModelClient(() => ({ text: '', json: { findings: [] } }));
    const disc = new StubModelClient(() => ({ text: '', json: { findings: [] } }));

    const filed: string[] = [];
    const room = new FakeBandTransport('r');
    await room.connectAgent({ agentId: 'adj', name: 'Adjudicator', handle: '@adjudicator', onMessage: async (m) => { filed.push(m.content); } });
    await room.connectAgent({ agentId: 'lead', name: 'Claims Lead', handle: '@claims-lead', onMessage: makePodLead({ pod: 'claims', members: ['@scout', '@claim-evidence', '@precedent', '@disclosure'], memberKeys: ['scout', 'claim-evidence', 'precedent', 'disclosure'], reportToHandle: '@adjudicator', debate: false }) });
    await room.connectAgent({ agentId: 'scout', name: 'Scout', handle: '@scout', onMessage: makeScout(scout) });
    await room.connectAgent({ agentId: 'ce', name: 'Claim & Evidence', handle: '@claim-evidence', onMessage: makeClaimEvidence(ce) });
    await room.connectAgent({ agentId: 'prec', name: 'Precedent', handle: '@precedent', onMessage: makePrecedent(prec) });
    await room.connectAgent({ agentId: 'disc', name: 'Disclosure', handle: '@disclosure', onMessage: makeDisclosure(disc) });

    room.post('cond', JSON.stringify(asset), [{ id: 'lead' }]);
    await room.drain();

    expect(filed).toHaveLength(1);
    const pf = JSON.parse(filed[0]);
    expect(pf.pod).toBe('claims');
    expect(pf.findings.some((f: { rationale: string }) => f.rationale.includes('source'))).toBe(true);
    expect(pf.conflicts).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/claims-pod.test.ts`
Expected: FAIL, cannot resolve `../src/agents/pod-members`.

- [ ] **Step 3: Implement `src/agents/pod-members.ts`**

```typescript
// src/agents/pod-members.ts
// Pod members and board specialists, all configs over the knowledge-source shell.
import type { AgentHandler } from '../band/types';
import type { ModelClient } from '../models/client';
import { makeKnowledgeSource } from './knowledge-source';
import { SCOUT_OUTPUT_JSON_SCHEMA } from '../domain/board';

// Shared output schema for finding-producing members.
export const FINDINGS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          severity: { type: 'string', enum: ['block', 'warn', 'info'] },
          claim: { type: 'string' },
          rationale: { type: 'string' },
          ruleId: { type: 'string' },
          requiredDisclosure: { type: ['string', 'null'] },
        },
        required: ['category', 'severity', 'claim', 'rationale'],
      },
    },
  },
  required: ['findings'],
} as const;

// Claims pod ------------------------------------------------------------
export const makeScout = (model: ModelClient, reportToHandle = '@claims-lead'): AgentHandler =>
  makeKnowledgeSource({
    role: 'scout', reviewerName: 'Scout', model, reportToHandle, eventType: 'workitem',
    jsonSchema: SCOUT_OUTPUT_JSON_SCHEMA,
    system: 'You are the Scout. Read the marketing asset and extract the discrete risky surfaces (factual or efficacy claims, comparative claims, calls to action, the image) as work-items. Return JSON { workItems: [{ id, kind, text, surfaces }] }.',
  });

export const makeClaimEvidence = (model: ModelClient, reportToHandle = '@claims-lead'): AgentHandler =>
  makeKnowledgeSource({
    role: 'claim-evidence', reviewerName: 'Claim & Evidence', model, reportToHandle,
    jsonSchema: FINDINGS_JSON_SCHEMA,
    system: 'You are the Claim & Evidence reviewer. For each factual or efficacy claim, decide if it is substantiated by the asset\'s evidence. Flag unsupported claims as a finding with severity "warn" and rationale demanding a source. Return JSON { findings: [...] }. This is not legal advice.',
  });

export const makePrecedent = (model: ModelClient, reportToHandle = '@claims-lead'): AgentHandler =>
  makeKnowledgeSource({
    role: 'precedent', reviewerName: 'Precedent Librarian', model, reportToHandle,
    jsonSchema: FINDINGS_JSON_SCHEMA,
    system: 'You are the Precedent Librarian. Attach any relevant prior ruling to the claims as informational findings (category "precedent", severity "info"). Return JSON { findings: [...] }.',
  });

export const makeDisclosure = (model: ModelClient, reportToHandle = '@claims-lead'): AgentHandler =>
  makeKnowledgeSource({
    role: 'disclosure', reviewerName: 'Disclosure Drafter', model, reportToHandle,
    jsonSchema: FINDINGS_JSON_SCHEMA,
    system: 'You are the Disclosure Drafter. If a claim requires a mandatory disclosure (for example a typical-results statement or an EU Article 10(2) accompanying statement), produce a finding with severity "info", category "disclosure", and the exact required text in requiredDisclosure. Return JSON { findings: [...] }.',
  });

// Brand pod -------------------------------------------------------------
export const makeBrandVoice = (model: ModelClient, reportToHandle = '@brand-lead'): AgentHandler =>
  makeKnowledgeSource({
    role: 'brand-voice', reviewerName: 'Brand Voice', model, reportToHandle,
    jsonSchema: FINDINGS_JSON_SCHEMA,
    system: 'You are the Brand Voice reviewer. Flag copy that is off-voice or uses forbidden phrasing as findings (severity "warn"). Keep the asset bold and on-brand. Return JSON { findings: [...] }.',
  });

export const makeChannel = (model: ModelClient, reportToHandle = '@brand-lead'): AgentHandler =>
  makeKnowledgeSource({
    role: 'channel', reviewerName: 'Channel Fit', model, reportToHandle,
    jsonSchema: FINDINGS_JSON_SCHEMA,
    system: 'You are the Channel Fit reviewer. Check hook, length, and format against the asset\'s channel norms. Flag misfits as findings (severity "warn"). Return JSON { findings: [...] }.',
  });

export const makeVisual = (model: ModelClient, reportToHandle = '@brand-lead'): AgentHandler =>
  makeKnowledgeSource({
    role: 'visual', reviewerName: 'Visual / Image', model, reportToHandle,
    jsonSchema: FINDINGS_JSON_SCHEMA,
    system: 'You are the Visual reviewer. Check the image (imagePrompt / imageUrl) for brand fit and visual compliance. Flag issues as findings. Return JSON { findings: [...] }.',
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/claims-pod.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agents/pod-members.ts test/claims-pod.test.ts
git commit -m "feat(agents): pod members (scout, claim-evidence, precedent, disclosure, brand-voice, channel, visual)"
```

### Task 2.2: Brand pod integration test

**Files:**
- Test: `test/brand-pod.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// test/brand-pod.test.ts
import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { makePodLead } from '../src/agents/pod-lead';
import { makeBrandVoice, makeChannel, makeVisual } from '../src/agents/pod-members';
import { StubModelClient } from '../src/models/client';
import { loadAsset } from '../src/domain/load';

const ASSETS = new URL('../assets/', import.meta.url).pathname;

describe('brand pod', () => {
  it('files one brand PodFinding with no cross-region conflict', async () => {
    const asset = loadAsset(`${ASSETS}sample-asset.json`);
    const ok = new StubModelClient(() => ({ text: '', json: { findings: [] } }));
    const offVoice = new StubModelClient(() => ({ text: '', json: { findings: [{ category: 'voice', severity: 'warn', claim: asset.copy, rationale: 'too clinical' }] } }));
    const filed: string[] = [];
    const room = new FakeBandTransport('r');
    await room.connectAgent({ agentId: 'adj', name: 'Adjudicator', handle: '@adjudicator', onMessage: async (m) => { filed.push(m.content); } });
    await room.connectAgent({ agentId: 'lead', name: 'Brand Lead', handle: '@brand-lead', onMessage: makePodLead({ pod: 'brand', members: ['@brand-voice', '@channel', '@visual'], memberKeys: ['brand-voice', 'channel', 'visual'], reportToHandle: '@adjudicator', debate: false }) });
    await room.connectAgent({ agentId: 'bv', name: 'Brand Voice', handle: '@brand-voice', onMessage: makeBrandVoice(offVoice) });
    await room.connectAgent({ agentId: 'ch', name: 'Channel Fit', handle: '@channel', onMessage: makeChannel(ok) });
    await room.connectAgent({ agentId: 'vis', name: 'Visual', handle: '@visual', onMessage: makeVisual(ok) });

    room.post('cond', JSON.stringify(asset), [{ id: 'lead' }]);
    await room.drain();

    expect(filed).toHaveLength(1);
    const pf = JSON.parse(filed[0]);
    expect(pf.pod).toBe('brand');
    expect(pf.findings).toHaveLength(1);
    expect(pf.conflicts).toEqual([]);
  });
});
```

- [ ] **Step 2: Run + commit**

Run: `pnpm vitest run test/brand-pod.test.ts` (Expected: PASS)

```bash
git add test/brand-pod.test.ts
git commit -m "test(agents): brand pod files a consolidated finding"
```

---

## Phase 3: The board (Mediator)

### Task 3.1: Mediator resolves a conflict at the board

The Mediator wakes when the Adjudicator hands it the unresolved conflicts. It makes one model call and posts a `MediationResult` back. (Disclosure text lives in the Claims pod; the Mediator only brokers.)

**Files:**
- Create: `src/agents/mediator.ts`
- Test: `test/mediator.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/mediator.test.ts
import { describe, expect, it } from 'vitest';
import { FakeBandTransport } from '../src/band/fake';
import { makeMediator } from '../src/agents/mediator';
import { StubModelClient } from '../src/models/client';

const mediate = JSON.stringify({
  kind: 'mediate',
  conflicts: [{ span: 'boost', blockedBy: ['EU'], passedBy: ['US'], rationale: 'Article 10(2)' }],
});

describe('mediator', () => {
  it('posts a MediationResult addressed to the adjudicator', async () => {
    const model = new StubModelClient(() => ({ text: '', json: { resolved: false, note: 'EU will not move without authorization', requiredDisclosure: null } }));
    const got: string[] = [];
    const room = new FakeBandTransport('r');
    await room.connectAgent({ agentId: 'adj', name: 'Adjudicator', handle: '@adjudicator', onMessage: async (m) => { got.push(m.content); } });
    await room.connectAgent({ agentId: 'med', name: 'Mediator', handle: '@mediator', onMessage: makeMediator({ model, reportToHandle: '@adjudicator' }) });
    room.post('adj', mediate, [{ id: 'med' }]);
    await room.drain();
    const payload = JSON.parse(got[0]);
    expect(payload.kind).toBe('mediation');
    expect(payload.resolved).toBe(false);
    expect(payload.note).toContain('authorization');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/mediator.test.ts`
Expected: FAIL, cannot resolve `../src/agents/mediator`.

- [ ] **Step 3: Implement `src/agents/mediator.ts`**

```typescript
// src/agents/mediator.ts
import type { AgentHandler } from '../band/types';
import type { ModelClient } from '../models/client';
import { matchParticipant } from './handles';
import { MEDIATION_JSON_SCHEMA } from '../domain/board';

export interface MediatorOptions {
  model: ModelClient;
  reportToHandle: string; // '@adjudicator'
}

export function makeMediator(opts: MediatorOptions): AgentHandler {
  return async (message, tools) => {
    let body: { kind?: string; conflicts?: unknown } | null = null;
    try { body = JSON.parse(message.content); } catch { return; }
    if (!body || body.kind !== 'mediate') return;

    const res = await opts.model.complete({
      system: 'You are the Mediator at a marketing compliance review board. Given the conflicts (a span some reviewers block and others pass), propose the smallest resolution that satisfies every mandate. If none exists, set resolved=false. If a disclosure unlocks it, put the exact text in requiredDisclosure. Return JSON. This is not legal advice.',
      messages: [{ role: 'user', content: `Conflicts: ${JSON.stringify(body.conflicts ?? [])}` }],
      jsonSchema: MEDIATION_JSON_SCHEMA,
    });
    const out = (res.json ?? {}) as { resolved?: boolean; note?: string; requiredDisclosure?: string | null };
    const result = {
      kind: 'mediation' as const,
      resolved: out.resolved ?? false,
      note: out.note ?? '',
      requiredDisclosure: out.requiredDisclosure ?? null,
    };
    await tools.sendEvent(`Mediator: ${result.resolved ? 'resolved' : 'no movement'}`, 'mediation', { resolved: result.resolved });
    const target = matchParticipant(await tools.getParticipants(), opts.reportToHandle, 'agent');
    const mention = target ? [{ id: target.id, handle: target.handle }] : [{ id: message.senderId }];
    await tools.sendMessage(JSON.stringify(result), mention);
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/mediator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agents/mediator.ts test/mediator.test.ts
git commit -m "feat(agents): mediator brokers board conflicts into a MediationResult"
```

---
