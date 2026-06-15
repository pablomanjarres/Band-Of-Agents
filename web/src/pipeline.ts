// Pure selector that derives the live pipeline diagram model from the board
// state. Every node and edge is computed from the existing BoardState (which is
// itself folded from BoardEvents), so the diagram stays a dumb renderer and the
// mapping is testable in isolation. Repeated review / verdict rounds simply
// re-derive the same node ids, keeping the animation idempotent.

import type { BoardState, RegionState, RegionStatus } from './boardState';
import { REGION_ORDER } from './boardState';
import type { VerdictDecision } from './types';

// Visual family for a node. Drives its colour palette in DiagramNode.
export type NodeVariant = 'context' | 'ai' | 'human' | 'outcome';

// Lifecycle of a node, independent of its variant. A region node additionally
// carries a verdict (publish | adapt | escalate) once it leaves "reviewing".
export type NodeActivity = 'idle' | 'active' | 'done';

// Stable identifiers for every node in the diagram.
export type NodeId =
  | 'context'
  | 'coordinator'
  | 'reconcile'
  | 'remediation'
  | 'publish'
  | 'compliance'
  | `agent:${string}`;

export interface AgentNodeModel {
  id: NodeId;
  region: string;
  title: string;
  subtitle: string;
  activity: NodeActivity;
  // Present once a verdict has landed for this region.
  verdict?: VerdictDecision;
  blocking: number;
  findings: number;
  reviewerName?: string;
}

// Identifiers for every drawn edge. Used both as React keys and as the
// activation lookup in the diagram overlay.
export type EdgeId =
  | 'context-coordinator'
  | 'coordinator-agents'
  | 'agents-reconcile'
  | 'reconcile-remediation'
  | 'reconcile-publish'
  | 'reconcile-compliance'
  | 'remediation-agents'
  | 'compliance-context';

export interface PipelineModel {
  context: { activity: NodeActivity; pulse: boolean };
  coordinator: { activity: NodeActivity; recruitCount?: number; reReview: boolean };
  agents: AgentNodeModel[];
  reconcile: { activity: NodeActivity; conflict: boolean; summary?: string };
  remediation: { activity: NodeActivity };
  publish: { activity: NodeActivity; regions: string[] };
  compliance: { activity: NodeActivity; awaitingDecision: boolean };
  // Set of edge ids that are currently "lit".
  activeEdges: ReadonlySet<EdgeId>;
}

const AGENT_META: Record<string, { title: string; subtitle: string }> = {
  US: { title: 'US agent', subtitle: 'US ad rules' },
  EU: { title: 'EU agent', subtitle: 'EU + GDPR' },
  LATAM: { title: 'LATAM agent', subtitle: 'LATAM rules' },
  BRAND: { title: 'Brand agent', subtitle: 'stays on-brand' },
};

function agentMeta(region: string): { title: string; subtitle: string } {
  return AGENT_META[region] ?? { title: `${region} agent`, subtitle: `${region} rules` };
}

// "Intake: asset ... Recruiting 6 reviewer(s)." -> 6
function parseRecruitCount(text: string): number | undefined {
  const match = /Recruiting\s+(\d+)/i.exec(text);
  if (!match) return undefined;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : undefined;
}

function verdictOf(status: RegionStatus): VerdictDecision | undefined {
  return status === 'reviewing' ? undefined : status;
}

function regionActivity(region: RegionState): NodeActivity {
  return region.status === 'reviewing' ? 'active' : 'done';
}

export function buildPipelineModel(state: BoardState): PipelineModel {
  const events = state.events;
  const has = (type: string): boolean => events.some((event) => event.type === type);

  // --- Coordinator -------------------------------------------------------
  const recruitEvents = events.filter(
    (event): event is Extract<typeof event, { type: 'recruited' }> => event.type === 'recruited',
  );
  const lastRecruit = recruitEvents[recruitEvents.length - 1];
  const recruitCount = lastRecruit ? parseRecruitCount(lastRecruit.text) : undefined;
  const reReview = recruitEvents.some((event) => /re-?review/i.test(event.text));
  const intakeSeen = has('intake') || has('recruited');
  const anyReview = has('review');
  const coordinatorActivity: NodeActivity = !intakeSeen
    ? 'idle'
    : anyReview
      ? 'done'
      : 'active';

  // --- Region / brand agents --------------------------------------------
  const agents: AgentNodeModel[] = REGION_ORDER.map((region) => {
    const node = state.regions[region];
    const meta = agentMeta(region);
    const activity: NodeActivity = node ? regionActivity(node) : 'idle';
    const verdict = node ? verdictOf(node.status) : undefined;
    return {
      id: `agent:${region}`,
      region,
      title: meta.title,
      subtitle: meta.subtitle,
      activity,
      ...(verdict ? { verdict } : {}),
      blocking: node?.blocking ?? 0,
      findings: node?.findings.length ?? 0,
      ...(node?.reviewerName ? { reviewerName: node.reviewerName } : {}),
    };
  });
  const anyVerdict = has('verdict');

  // --- Reconcile ---------------------------------------------------------
  const reconcileActivity: NodeActivity = !anyReview ? 'idle' : anyVerdict ? 'done' : 'active';
  const decided = agents.filter((agent) => agent.verdict);
  const summary =
    decided.length > 0
      ? decided.map((agent) => `${agent.region} ${agent.verdict}`).join('  ')
      : undefined;

  // --- Outcome lanes -----------------------------------------------------
  const publishRegions = agents
    .filter((agent) => agent.verdict === 'publish')
    .map((agent) => agent.region);
  const hasAdapt = agents.some((agent) => agent.verdict === 'adapt');
  const hasEscalate = agents.some((agent) => agent.verdict === 'escalate');

  const remediationActive = Boolean(state.remediation);
  const remediationActivity: NodeActivity = remediationActive
    ? 'done'
    : hasAdapt
      ? 'active'
      : 'idle';

  const publishActivity: NodeActivity = publishRegions.length > 0 ? 'done' : 'idle';

  const escalated = Boolean(state.escalationText) || hasEscalate;
  const awaitingDecision = state.status === 'awaiting-decision';
  const decisionRecorded = Boolean(state.decisionText);
  const complianceActivity: NodeActivity = !escalated
    ? 'idle'
    : decisionRecorded
      ? 'done'
      : 'active';

  // --- Edges -------------------------------------------------------------
  const activeEdges = new Set<EdgeId>();
  if (intakeSeen) activeEdges.add('context-coordinator');
  if (coordinatorActivity !== 'idle' && (anyReview || coordinatorActivity === 'active')) {
    activeEdges.add('coordinator-agents');
  }
  if (anyReview) activeEdges.add('agents-reconcile');
  if (hasAdapt || remediationActive) activeEdges.add('reconcile-remediation');
  if (publishRegions.length > 0) activeEdges.add('reconcile-publish');
  if (escalated) activeEdges.add('reconcile-compliance');
  if (remediationActive) activeEdges.add('remediation-agents');
  if (decisionRecorded) activeEdges.add('compliance-context');

  return {
    context: { activity: 'done', pulse: decisionRecorded },
    coordinator: {
      activity: coordinatorActivity,
      ...(recruitCount !== undefined ? { recruitCount } : {}),
      reReview,
    },
    agents,
    reconcile: {
      activity: reconcileActivity,
      conflict: state.conflict,
      ...(summary ? { summary } : {}),
    },
    remediation: { activity: remediationActivity },
    publish: { activity: publishActivity, regions: publishRegions },
    compliance: { activity: complianceActivity, awaitingDecision },
    activeEdges,
  };
}
