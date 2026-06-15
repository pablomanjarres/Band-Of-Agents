// UI-facing event model for the review console. Raw BoardActivity from a
// transport is translated into typed BoardEvents that the server streams over
// SSE; the React board derives region-card state and the timeline from them.

import type { BoardActivity } from '../band/types';
import type { ContentAsset, Finding, RegionVerdict } from '../domain/types';

export type BoardEvent =
  | { type: 'intake'; seq: number; fromName: string; asset: ContentAsset }
  | { type: 'recruited'; seq: number; fromName: string; text: string }
  | {
      type: 'review';
      seq: number;
      fromName: string;
      region: string;
      reviewerName: string;
      findings: Finding[];
      blocking: number;
    }
  | { type: 'progress'; seq: number; fromName: string; text: string }
  | { type: 'verdict'; seq: number; fromName: string; verdicts: RegionVerdict[]; conflict: boolean }
  | {
      type: 'revised';
      seq: number;
      fromName: string;
      region: string;
      copy: string;
      imageUrl?: string;
      markets: string[];
    }
  | { type: 'escalation'; seq: number; fromName: string; text: string }
  | { type: 'decision'; seq: number; fromName: string; text: string }
  | { type: 'log'; seq: number; fromName: string; messageType: string; text: string }
  | { type: 'status'; seq: number; fromName: string; status: BoardStatus }
  | { type: 'workitem'; seq: number; fromName: string; text: string }
  | { type: 'debate'; seq: number; fromName: string; text: string }
  | { type: 'pod-finding'; seq: number; fromName: string; pod: string; conflicts: number; text: string }
  | { type: 'mediation'; seq: number; fromName: string; resolved: boolean; text: string }
  | { type: 'adjudication'; seq: number; fromName: string; decision: string; text: string }
  | { type: 'terminal'; seq: number; fromName: string; decision: 'published' | 'spiked' | 'escalated' };

export type BoardStatus = 'running' | 'awaiting-decision' | 'complete' | 'error';

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

/**
 * Map one unit of room activity to a UI timeline event, or null to drop it.
 * Structured state (intake, reviews, verdicts, revisions) now lives on the
 * SharedBoard and is emitted as typed events directly, so any raw JSON in chat
 * (e.g. a dev asset post) is dropped here and prose becomes a log line. The room
 * itself stays plain English.
 */
export function translateActivity(a: BoardActivity): BoardEvent | null {
  const base = { seq: a.seq, fromName: a.fromName };

  if (a.kind === 'message') {
    if (parseJson(a.content) !== undefined) return null; // structured payloads come from the board
    if (a.content.startsWith('Escalation for')) return null;
    return { type: 'log', ...base, messageType: 'message', text: a.content };
  }

  if (a.messageType === 'workitem') return { type: 'workitem', ...base, text: a.content };
  if (a.messageType === 'debate') return { type: 'debate', ...base, text: a.content };
  if (a.messageType === 'pod-finding')
    return { type: 'pod-finding', ...base, pod: String(a.metadata?.pod ?? ''), conflicts: Number(a.metadata?.conflicts ?? 0), text: a.content };
  if (a.messageType === 'mediation')
    return { type: 'mediation', ...base, resolved: Boolean(a.metadata?.resolved), text: a.content };
  if (a.messageType === 'adjudication')
    return { type: 'adjudication', ...base, decision: String(a.metadata?.decision ?? ''), text: a.content };
  if (a.messageType === 'terminal')
    return { type: 'terminal', ...base, decision: (a.metadata?.decision as 'published' | 'spiked' | 'escalated') ?? 'published' };

  switch (a.messageType) {
    case 'intake':
      return { type: 'recruited', ...base, text: a.content };
    case 'review':
      return null;
    case 'reconcile':
      return { type: 'progress', ...base, text: a.content };
    case 'verdict':
      return null;
    case 'escalation':
      return { type: 'escalation', ...base, text: a.content };
    case 'decision':
      return { type: 'decision', ...base, text: a.content };
    case 'remediation':
      return { type: 'log', ...base, messageType: 'remediation', text: a.content };
    default:
      return { type: 'log', ...base, messageType: a.messageType, text: a.content };
  }
}
