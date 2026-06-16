// Pure selector that derives the live board diagram model from the board state.
// Every node and edge is computed from the existing BoardState (which is itself
// folded from BoardEvents), so the diagram stays a dumb renderer and the mapping
// is testable in isolation. The topology is the pods -> board -> spine shape:
// three deliberation pods file findings to a shared board, where a Mediator and
// a Risk Adjudicator drive a terminal verdict, with one recommit loop back to
// the asset. Re-deriving from the same state keeps the animation idempotent.

import type { BoardPhase, BoardState, PodState } from './boardState';

// Visual family for a node. Drives its colour palette in DiagramNode.
export type NodeVariant = 'context' | 'ai' | 'human' | 'outcome';

// Lifecycle of a node, independent of its variant.
export type NodeActivity = 'idle' | 'active' | 'done';

// The three pods, in fixed left-rail order.
export const POD_ORDER = ['claims', 'regulatory', 'brand'] as const;
export type PodName = (typeof POD_ORDER)[number];

// Stable identifiers for every node in the diagram.
export type NodeId =
  | 'asset'
  | 'pod:claims'
  | 'pod:regulatory'
  | 'pod:brand'
  | 'board'
  | 'adjudicator'
  | 'published'
  | 'spiked'
  | 'human';

// A pod container node: lit once it has filed its consolidated finding, and
// annotated with the number of cross-pod conflicts it carried.
export interface PodNodeModel {
  id: Extract<NodeId, `pod:${string}`>;
  pod: PodName;
  title: string;
  subtitle: string;
  members: string;
  activity: NodeActivity;
  filed: boolean;
  conflicts: number;
}

// Identifiers for every drawn edge. Used both as React keys and as the
// activation lookup in the diagram overlay.
export type EdgeId =
  | 'asset-claims'
  | 'asset-regulatory'
  | 'asset-brand'
  | 'claims-board'
  | 'regulatory-board'
  | 'brand-board'
  | 'board-adjudicator'
  | 'adjudicator-published'
  | 'adjudicator-spiked'
  | 'adjudicator-human'
  | 'adjudicator-asset'; // the recommit loop

export interface PipelineModel {
  asset: { activity: NodeActivity; assetId?: string };
  pods: PodNodeModel[];
  board: { activity: NodeActivity; conflicts: number; mediating: boolean };
  adjudicator: { activity: NodeActivity; decision?: string };
  published: { activity: NodeActivity };
  spiked: { activity: NodeActivity };
  human: { activity: NodeActivity; awaitingDecision: boolean };
  phase: BoardPhase;
  // The terminal the spine landed in, if any.
  terminal?: 'published' | 'spiked' | 'escalated';
  // Set of edge ids that are currently "lit".
  activeEdges: ReadonlySet<EdgeId>;
}

const POD_META: Record<PodName, { title: string; subtitle: string; members: string }> = {
  claims: { title: 'Claims pod', subtitle: 'evidence + precedent', members: 'scout, claim, precedent, disclosure' },
  regulatory: { title: 'Regulatory pod', subtitle: 'US / EU / LATAM debate', members: 'US, EU, LATAM' },
  brand: { title: 'Brand pod', subtitle: 'voice, channel, visual', members: 'voice, channel, visual' },
};

function podNodeId(pod: PodName): Extract<NodeId, `pod:${string}`> {
  return `pod:${pod}`;
}

export function buildPipelineModel(state: BoardState): PipelineModel {
  const events = state.events;
  const has = (type: string): boolean => events.some((event) => event.type === type);
  const phase = state.phase;
  const terminal = state.terminal;

  // --- Asset (intake) ----------------------------------------------------
  const assetSeen = Boolean(state.asset) || has('intake');
  // The asset stays "done" once seen; it pulses again only when a recommit
  // loop re-enters it (an adjudication asked for remediation, or a revision
  // landed). Otherwise idle before the first asset.
  const recommit =
    has('revised') ||
    events.some((event) => event.type === 'adjudication' && event.decision === 'remediate');
  const assetActivity: NodeActivity = !assetSeen ? 'idle' : recommit && phase !== 'terminal' ? 'active' : 'done';

  // --- Pods --------------------------------------------------------------
  const pods: PodNodeModel[] = POD_ORDER.map((pod) => {
    const podState: PodState | undefined = state.pods[pod];
    const meta = POD_META[pod];
    const filed = Boolean(podState?.filed);
    // A pod is "active" while it deliberates (asset seen, not yet filed), "done"
    // once it has filed, idle before intake.
    const activity: NodeActivity = filed ? 'done' : assetSeen && phase !== 'intake' ? 'active' : 'idle';
    return {
      id: podNodeId(pod),
      pod,
      title: meta.title,
      subtitle: meta.subtitle,
      members: meta.members,
      activity,
      filed,
      conflicts: podState?.conflicts ?? 0,
    };
  });
  const anyFiled = pods.some((pod) => pod.filed);
  const totalConflicts = pods.reduce((sum, pod) => sum + pod.conflicts, 0);

  // --- Board (Mediator) --------------------------------------------------
  // Lit while reconciling or deciding; done once the spine is terminal.
  const boardActivity: NodeActivity =
    phase === 'terminal'
      ? 'done'
      : phase === 'reconciling' || phase === 'deciding'
        ? 'active'
        : anyFiled
          ? 'active'
          : 'idle';
  const mediating = events.some((event) => event.type === 'mediation') || (phase === 'reconciling' && totalConflicts > 0);

  // --- Adjudicator (spine) ----------------------------------------------
  const adjudications = events.filter(
    (event): event is Extract<typeof event, { type: 'adjudication' }> => event.type === 'adjudication',
  );
  const lastAdjudication = adjudications.at(-1);
  const adjudicatorActivity: NodeActivity =
    phase === 'terminal' ? 'done' : phase === 'deciding' ? 'active' : adjudications.length > 0 ? 'active' : 'idle';

  // --- Terminals ---------------------------------------------------------
  const publishedActivity: NodeActivity = terminal === 'published' ? 'done' : 'idle';
  const spikedActivity: NodeActivity = terminal === 'spiked' ? 'done' : 'idle';
  const escalated = terminal === 'escalated' || Boolean(state.escalationText) || has('escalation');
  const awaitingDecision = state.status === 'awaiting-decision';
  const decisionRecorded = Boolean(state.decisionText) || terminal === 'escalated';
  const humanActivity: NodeActivity = !escalated ? 'idle' : decisionRecorded && terminal === 'escalated' ? 'done' : 'active';

  // --- Edges -------------------------------------------------------------
  const activeEdges = new Set<EdgeId>();
  if (assetSeen && phase !== 'intake') {
    activeEdges.add('asset-claims');
    activeEdges.add('asset-regulatory');
    activeEdges.add('asset-brand');
  }
  for (const pod of pods) {
    if (pod.filed) activeEdges.add(`${pod.pod}-board` as EdgeId);
  }
  if (anyFiled && (phase === 'reconciling' || phase === 'deciding' || phase === 'terminal')) {
    activeEdges.add('board-adjudicator');
  }
  if (terminal === 'published') activeEdges.add('adjudicator-published');
  if (terminal === 'spiked') activeEdges.add('adjudicator-spiked');
  if (escalated) activeEdges.add('adjudicator-human');
  if (recommit) activeEdges.add('adjudicator-asset');

  return {
    asset: { activity: assetActivity, ...(state.asset ? { assetId: state.asset.id } : {}) },
    pods,
    board: { activity: boardActivity, conflicts: totalConflicts, mediating },
    adjudicator: {
      activity: adjudicatorActivity,
      ...(lastAdjudication ? { decision: lastAdjudication.decision } : {}),
    },
    published: { activity: publishedActivity },
    spiked: { activity: spikedActivity },
    human: { activity: humanActivity, awaitingDecision },
    phase,
    ...(terminal ? { terminal } : {}),
    activeEdges,
  };
}
