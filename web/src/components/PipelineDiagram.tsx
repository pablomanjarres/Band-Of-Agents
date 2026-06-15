import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BoardState } from '../boardState';
import { buildPipelineModel } from '../pipeline';
import type { NodeId, PodNodeModel } from '../pipeline';
import { DiagramEdges } from './DiagramEdges';
import type { NodeRect, RectMap } from './DiagramEdges';
import { DiagramNode } from './DiagramNode';
import { EscalationDecision } from './EscalationDecision';

interface PipelineDiagramProps {
  state: BoardState;
}

// Pill badge used for counts / flags inside nodes.
function Pill({ tone, children }: { tone: 'red' | 'amber' | 'slate' | 'emerald' | 'indigo'; children: React.ReactNode }) {
  const styles: Record<typeof tone, string> = {
    red: 'bg-red-500/20 text-red-200 ring-red-400/40',
    amber: 'bg-amber-500/20 text-amber-100 ring-amber-400/40',
    slate: 'bg-slate-500/20 text-slate-200 ring-slate-400/30',
    emerald: 'bg-emerald-500/20 text-emerald-100 ring-emerald-400/40',
    indigo: 'bg-indigo-500/20 text-indigo-100 ring-indigo-400/40',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${styles[tone]}`}>
      {children}
    </span>
  );
}

// Status badge for a pod container: deliberating, filed, or a conflict count.
function PodBadge({ pod }: { pod: PodNodeModel }) {
  if (pod.activity === 'active') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-100 ring-1 ring-inset ring-indigo-400/40">
        <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-indigo-300" />
        deliberating
      </span>
    );
  }
  if (pod.filed) {
    return pod.conflicts > 0 ? (
      <Pill tone="amber">{pod.conflicts} conflict{pod.conflicts === 1 ? '' : 's'}</Pill>
    ) : (
      <Pill tone="emerald">filed</Pill>
    );
  }
  return null;
}

const LEGEND: { label: string; dot: string }[] = [
  { label: 'pod / board', dot: 'bg-indigo-400' },
  { label: 'human', dot: 'bg-emerald-400' },
  { label: 'terminal', dot: 'bg-slate-400' },
];

// Human-readable label for the phase chip in the header.
const PHASE_LABEL: Record<BoardState['phase'], string> = {
  intake: 'intake',
  deliberating: 'pods deliberating',
  reconciling: 'board reconciling',
  deciding: 'adjudicating',
  terminal: 'terminal',
};

// Compare two measured-rect maps so measure() can bail out when nothing moved.
// Without this, setRects/setSize always create new objects and the (deps-less)
// layout effect re-fires forever (maximum update depth exceeded -> blank screen).
function rectsEqual(a: RectMap, b: RectMap): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    const ra = a[key as NodeId];
    const rb = b[key as NodeId];
    if (!ra || !rb || ra.x !== rb.x || ra.y !== rb.y || ra.width !== rb.width || ra.height !== rb.height) {
      return false;
    }
  }
  return true;
}

export function PipelineDiagram({ state }: PipelineDiagramProps) {
  const model = buildPipelineModel(state);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Map<NodeId, HTMLDivElement>>(new Map());
  const [rects, setRects] = useState<RectMap>({});
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  // Provide a stable ref callback per node id so the SVG overlay can measure
  // anchor points. Storing into a Map keeps this O(1) and avoids re-creating
  // callbacks on every render.
  const setNodeRef = useCallback(
    (id: NodeId) => (el: HTMLDivElement | null) => {
      if (el) nodeRefs.current.set(id, el);
      else nodeRefs.current.delete(id);
    },
    [],
  );

  const measure = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const origin = canvas.getBoundingClientRect();
    const next: RectMap = {};
    for (const [id, el] of nodeRefs.current.entries()) {
      const box = el.getBoundingClientRect();
      const rect: NodeRect = {
        x: box.left - origin.left,
        y: box.top - origin.top,
        width: box.width,
        height: box.height,
      };
      next[id] = rect;
    }
    setRects((prev) => (rectsEqual(prev, next) ? prev : next));
    setSize((prev) =>
      prev.width === origin.width && prev.height === origin.height ? prev : { width: origin.width, height: origin.height },
    );
  }, []);

  // Measure after layout and whenever the model shape changes (pods fill, the
  // board lights up, a terminal node resolves, the decision form appears, etc.).
  useLayoutEffect(() => {
    measure();
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(canvas);
    for (const el of nodeRefs.current.values()) observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-200">
            Blackboard pods on a decision spine
          </h2>
          <p className="text-[11px] text-slate-500">
            Three pods deliberate, file findings to the board, and a Risk Adjudicator drives a terminal verdict.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Pill tone="indigo">{PHASE_LABEL[model.phase]}</Pill>
          {LEGEND.map((item) => (
            <span key={item.label} className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
              <span className={`h-2 w-2 rounded-full ${item.dot}`} />
              {item.label}
            </span>
          ))}
        </div>
      </div>

      <div
        ref={canvasRef}
        className="relative bg-[radial-gradient(circle_at_50%_0%,rgba(79,70,229,0.12),transparent_60%)] px-5 py-7"
      >
        <DiagramEdges rects={rects} activeEdges={model.activeEdges} width={size.width} height={size.height} />

        {/* Node layer sits above the edges. */}
        <div className="relative z-10 flex flex-col items-stretch gap-10">
          {/* Asset (intake). */}
          <div className="flex justify-center">
            <DiagramNode
              nodeRef={setNodeRef('asset')}
              variant="context"
              activity={model.asset.activity}
              title="Asset"
              subtitle="marketing content under review"
              className="w-64 text-center"
              badge={model.asset.assetId ? <Pill tone="slate">{model.asset.assetId}</Pill> : undefined}
            />
          </div>

          {/* Pods (left) -> board + adjudicator (center) -> terminals (right). */}
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start">
            {/* Left rail: the three deliberation pods. */}
            <div className="flex flex-col gap-4">
              {model.pods.map((pod) => (
                <DiagramNode
                  key={pod.id}
                  nodeRef={setNodeRef(pod.id)}
                  variant="ai"
                  activity={pod.activity}
                  title={pod.title}
                  subtitle={pod.subtitle}
                  badge={<PodBadge pod={pod} />}
                >
                  <p className="text-[10px] uppercase tracking-wide text-indigo-300/70">{pod.members}</p>
                </DiagramNode>
              ))}
            </div>

            {/* Spine: the shared board over the Risk Adjudicator. */}
            <div className="flex flex-col gap-8 lg:pt-6">
              <DiagramNode
                nodeRef={setNodeRef('board')}
                variant="ai"
                activity={model.board.activity}
                title="Board"
                subtitle="Mediator reconciles cross-pod conflict"
                className="text-center"
                badge={
                  model.board.conflicts > 0 ? (
                    <Pill tone="amber">{model.board.conflicts} conflict{model.board.conflicts === 1 ? '' : 's'}</Pill>
                  ) : undefined
                }
              >
                {model.board.mediating ? (
                  <p className="text-[10px] font-medium uppercase tracking-wide text-amber-300/80">
                    mediating
                  </p>
                ) : null}
              </DiagramNode>

              <DiagramNode
                nodeRef={setNodeRef('adjudicator')}
                variant="ai"
                activity={model.adjudicator.activity}
                title="Risk Adjudicator"
                subtitle="scores the board, drives the verdict"
                className="text-center"
                badge={model.adjudicator.decision ? <Pill tone="indigo">{model.adjudicator.decision}</Pill> : undefined}
              />
            </div>

            {/* Right rail: the terminal states. */}
            <div className="flex flex-col gap-4 lg:pt-6">
              <DiagramNode
                nodeRef={setNodeRef('published')}
                variant="outcome"
                activity={model.published.activity}
                title="Published"
                subtitle="cleared to ship"
                badge={model.terminal === 'published' ? <Pill tone="emerald">final</Pill> : undefined}
              />
              <DiagramNode
                nodeRef={setNodeRef('spiked')}
                variant="outcome"
                activity={model.spiked.activity}
                title="Spiked"
                subtitle="killed by the board"
                badge={model.terminal === 'spiked' ? <Pill tone="red">final</Pill> : undefined}
              />
              <DiagramNode
                nodeRef={setNodeRef('human')}
                variant="human"
                activity={model.human.activity}
                title="Compliance lead"
                subtitle="rules on genuine deadlocks"
              >
                {state.escalationText ? (
                  <EscalationDecision
                    text={state.escalationText}
                    recordedDecision={state.decisionText}
                    variant="diagram"
                  />
                ) : (
                  <p className="text-[11px] text-slate-500">No escalation. Lit only on a deadlock.</p>
                )}
              </DiagramNode>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
