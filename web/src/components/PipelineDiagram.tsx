import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BoardState } from '../boardState';
import { buildPipelineModel } from '../pipeline';
import type { AgentNodeModel, NodeId } from '../pipeline';
import { DiagramEdges } from './DiagramEdges';
import type { NodeRect, RectMap } from './DiagramEdges';
import { DiagramNode } from './DiagramNode';
import { EscalationDecision } from './EscalationDecision';

interface PipelineDiagramProps {
  state: BoardState;
}

// Pill badge used for counts / flags inside nodes.
function Pill({ tone, children }: { tone: 'red' | 'amber' | 'slate' | 'emerald'; children: React.ReactNode }) {
  const styles: Record<typeof tone, string> = {
    red: 'bg-danger/15 text-danger ring-danger/30',
    amber: 'bg-warn/15 text-warn ring-warn/30',
    slate: 'bg-surface-3 text-muted ring-border-strong',
    emerald: 'bg-human/15 text-human ring-human/30',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${styles[tone]}`}>
      {children}
    </span>
  );
}

function AgentBadge({ agent }: { agent: AgentNodeModel }) {
  if (agent.activity === 'active') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-accent ring-1 ring-inset ring-accent/30">
        <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent" />
        reviewing
      </span>
    );
  }
  if (agent.verdict === 'publish') return <Pill tone="emerald">publish</Pill>;
  if (agent.verdict === 'adapt') return <Pill tone="amber">adapt</Pill>;
  if (agent.verdict === 'escalate') return <Pill tone="red">escalate</Pill>;
  return null;
}

const LEGEND: { label: string; dot: string }[] = [
  { label: 'AI agent', dot: 'bg-accent' },
  { label: 'human', dot: 'bg-human' },
  { label: 'context / outcome', dot: 'bg-muted' },
];

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

  // Measure after layout and whenever the model shape changes (new nodes light
  // up, remediation image expands a node, the decision form appears, etc.).
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

  const remediation = state.remediation;

  return (
    <section className="surface-2 overflow-hidden rounded-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <div>
          <p className="eyebrow mb-1.5">Live orchestration</p>
          <h2 className="font-display text-xl leading-none text-fg">Multi-agent review pipeline</h2>
          <p className="mt-1.5 text-[11px] text-faint">
            Coordinated negotiation: recruit, review, reconcile, remediate, re-review, escalate.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {LEGEND.map((item) => (
            <span key={item.label} className="inline-flex items-center gap-1.5 text-[11px] text-muted">
              <span className={`h-2 w-2 rounded-full ${item.dot}`} />
              {item.label}
            </span>
          ))}
        </div>
      </div>

      <div
        ref={canvasRef}
        className="relative bg-[radial-gradient(circle_at_50%_-10%,rgba(99,102,241,0.14),transparent_55%)] px-5 py-7"
      >
        <DiagramEdges rects={rects} activeEdges={model.activeEdges} width={size.width} height={size.height} />

        {/* Node layer sits above the edges. */}
        <div className="relative z-10 flex flex-col items-stretch gap-10">
          {/* Shared context. */}
          <div className="flex justify-center">
            <DiagramNode
              nodeRef={setNodeRef('context')}
              variant="context"
              activity={model.context.activity}
              title="Shared context"
              subtitle="brand DNA + region rules"
              className="w-60 text-center"
              badge={model.context.pulse ? <Pill tone="slate">precedent</Pill> : undefined}
            />
          </div>

          {/* Coordinator. */}
          <div className="flex justify-center">
            <DiagramNode
              nodeRef={setNodeRef('coordinator')}
              variant="ai"
              activity={model.coordinator.activity}
              title="Coordinator"
              subtitle="recruits region agents"
              className="w-64 text-center"
              badge={
                model.coordinator.recruitCount !== undefined ? (
                  <Pill tone="slate">{model.coordinator.recruitCount} recruited</Pill>
                ) : undefined
              }
            >
              {model.coordinator.reReview ? (
                <p className="font-mono text-[10px] font-medium uppercase tracking-wider text-accent/80">
                  re-review round dispatched
                </p>
              ) : null}
            </DiagramNode>
          </div>

          {/* Region / brand agents row. */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {model.agents.map((agent) => (
              <DiagramNode
                key={agent.id}
                nodeRef={setNodeRef(agent.id)}
                variant="ai"
                activity={agent.activity}
                {...(agent.verdict ? { verdict: agent.verdict } : {})}
                title={agent.title}
                subtitle={agent.subtitle}
                badge={<AgentBadge agent={agent} />}
              >
                {agent.activity !== 'idle' ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {agent.blocking > 0 ? (
                      <Pill tone="red">{agent.blocking} blocking</Pill>
                    ) : agent.findings > 0 ? (
                      <Pill tone="amber">{agent.findings} finding{agent.findings === 1 ? '' : 's'}</Pill>
                    ) : agent.activity === 'done' ? (
                      <Pill tone="emerald">clear</Pill>
                    ) : null}
                  </div>
                ) : null}
              </DiagramNode>
            ))}
          </div>

          {/* Reconcile. */}
          <div className="flex justify-center">
            <DiagramNode
              nodeRef={setNodeRef('reconcile')}
              variant="ai"
              activity={model.reconcile.activity}
              title="Reconcile agent"
              subtitle="per-region verdict"
              className="w-80 text-center"
              badge={model.reconcile.conflict ? <Pill tone="amber">conflict</Pill> : undefined}
            >
              {model.reconcile.summary ? (
                <p className="font-mono text-[11px] tracking-tight text-muted">
                  {model.reconcile.summary}
                </p>
              ) : null}
            </DiagramNode>
          </div>

          {/* Outcome row. */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:items-start">
            <DiagramNode
              nodeRef={setNodeRef('remediation')}
              variant="ai"
              activity={model.remediation.activity}
              title="Remediation"
              subtitle="adapt per region"
            >
              {remediation ? (
                <div className="space-y-2">
                  {remediation.imageUrl ? (
                    <img
                      src={remediation.imageUrl}
                      alt={`Revised creative for ${remediation.region}`}
                      className="h-28 w-full rounded-lg border border-accent/30 object-cover"
                    />
                  ) : null}
                  <p className="line-clamp-3 rounded-md border border-accent/20 bg-bg-soft/70 p-2 text-[11px] leading-snug text-muted">
                    {remediation.copy}
                  </p>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-accent/70">
                    {remediation.region} - {remediation.markets.join(', ') || 'no markets'}
                  </p>
                </div>
              ) : (
                <p className="text-[11px] text-faint">Idle until a region needs adaptation.</p>
              )}
            </DiagramNode>

            <DiagramNode
              nodeRef={setNodeRef('publish')}
              variant="outcome"
              activity={model.publish.activity}
              title="Publish"
              subtitle="per passing region"
            >
              {model.publish.regions.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {model.publish.regions.map((region) => (
                    <Pill key={region} tone="emerald">
                      {region}
                    </Pill>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-faint">No region cleared yet.</p>
              )}
            </DiagramNode>

            <DiagramNode
              nodeRef={setNodeRef('compliance')}
              variant="human"
              activity={model.compliance.activity}
              title="Compliance lead"
              subtitle="rules on gray areas"
            >
              {state.escalationText ? (
                <EscalationDecision
                  text={state.escalationText}
                  recordedDecision={state.decisionText}
                  variant="diagram"
                />
              ) : (
                <p className="text-[11px] text-faint">No escalation. Lit only on gray areas.</p>
              )}
            </DiagramNode>
          </div>
        </div>
      </div>
    </section>
  );
}
