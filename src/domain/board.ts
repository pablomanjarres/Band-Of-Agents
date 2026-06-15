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
