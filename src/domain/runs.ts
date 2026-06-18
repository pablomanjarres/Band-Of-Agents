import { z } from 'zod';

// A "run" is one band.ai review session, mirrored into the dashboard so the UI
// shows the band.ai workflow live: requested -> perceiving -> reviewing -> report
// -> awaiting-decision -> decided, plus any new materials the agents propose. The
// band.ai agents POST a run when a review starts and append an event per beat; the
// dashboard subscribes and renders the timeline. This is the visible bridge between
// band.ai and the UI (the agents drive it; the UI never runs a review itself).
export const RunStageSchema = z.enum([
  'requested', // a human asked the Conductor to review (in band.ai)
  'perceiving', // transcript / keyframes / vision pass on a material
  'reviewing', // a pod or reviewer is checking the material
  'report', // the Adjudicator posted the report
  'awaiting-decision', // a block needs the human to rule in band.ai
  'decided', // the human ruled (publish / spike / fork per market)
  'material', // an agent produced a new material (remediated copy / image)
  'log', // any other narration beat
]);
export type RunStage = z.infer<typeof RunStageSchema>;

export const RunStatusSchema = z.enum(['running', 'awaiting-decision', 'complete', 'error']);
export type RunStatus = z.infer<typeof RunStatusSchema>;

// A produced artifact surfaced on the run (a generated image or the report).
export const RunArtifactSchema = z.object({
  kind: z.enum(['image', 'report']),
  url: z.string(),
  title: z.string().optional(),
});
export type RunArtifact = z.infer<typeof RunArtifactSchema>;

// What an agent POSTs for each lifecycle beat; the server stamps seq + at.
export const RunEventInputSchema = z.object({
  stage: RunStageSchema,
  message: z.string(),
  agent: z.string().optional(), // who emitted it (Conductor, EU Reviewer, Adjudicator...)
  materialId: z.string().optional(),
  artifact: RunArtifactSchema.optional(),
  status: RunStatusSchema.optional(), // optionally advance the run status with this beat
});
export type RunEventInput = z.infer<typeof RunEventInputSchema>;

export interface RunEvent {
  seq: number;
  at: number;
  stage: RunStage;
  message: string;
  agent?: string;
  materialId?: string;
  artifact?: RunArtifact;
}

export const CreateRunSchema = z.object({
  campaignId: z.string(),
  advertisementId: z.string().optional(),
  materialId: z.string().optional(),
  label: z.string().optional(),
});
export type CreateRunInput = z.infer<typeof CreateRunSchema>;

export interface Run {
  id: string;
  campaignId: string;
  advertisementId?: string;
  materialId?: string;
  label: string;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  events: RunEvent[];
}

// A compact summary for the campaign's run list (no full event log).
export interface RunSummary {
  id: string;
  campaignId: string;
  advertisementId?: string;
  label: string;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  eventCount: number;
  lastStage?: RunStage;
  lastMessage?: string;
}

export function toRunSummary(run: Run): RunSummary {
  const last = run.events[run.events.length - 1];
  return {
    id: run.id,
    campaignId: run.campaignId,
    ...(run.advertisementId ? { advertisementId: run.advertisementId } : {}),
    label: run.label,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    eventCount: run.events.length,
    ...(last ? { lastStage: last.stage, lastMessage: last.message } : {}),
  };
}
