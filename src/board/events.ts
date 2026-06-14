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
  | { type: 'status'; seq: number; fromName: string; status: BoardStatus };

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
