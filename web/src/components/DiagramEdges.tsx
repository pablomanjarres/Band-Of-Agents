import { Fragment } from 'react';
import type { EdgeId, NodeId } from '../pipeline';

// A node's bounding box measured relative to the canvas origin.
export interface NodeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type RectMap = Partial<Record<NodeId, NodeRect>>;

type Side = 'top' | 'bottom' | 'left' | 'right';

interface Point {
  x: number;
  y: number;
}

interface EdgeSpec {
  id: EdgeId;
  from: NodeId;
  to: NodeId;
  fromSide: Side;
  toSide: Side;
  label?: string;
  dashed?: boolean;
  // Tone of the edge; mirrors the destination node family.
  tone: 'ai' | 'human' | 'outcome' | 'context';
}

// Declarative wiring of the diagram. Order is irrelevant; ids must be unique.
const EDGES: EdgeSpec[] = [
  { id: 'context-coordinator', from: 'context', to: 'coordinator', fromSide: 'bottom', toSide: 'top', tone: 'context' },
  { id: 'coordinator-agents', from: 'coordinator', to: 'agent:EU', fromSide: 'bottom', toSide: 'top', tone: 'ai' },
  { id: 'agents-reconcile', from: 'agent:EU', to: 'reconcile', fromSide: 'bottom', toSide: 'top', tone: 'ai' },
  { id: 'reconcile-remediation', from: 'reconcile', to: 'remediation', fromSide: 'bottom', toSide: 'top', label: 'adapt', tone: 'ai' },
  { id: 'reconcile-publish', from: 'reconcile', to: 'publish', fromSide: 'bottom', toSide: 'top', label: 'publish', tone: 'outcome' },
  { id: 'reconcile-compliance', from: 'reconcile', to: 'compliance', fromSide: 'bottom', toSide: 'top', label: 'escalate', tone: 'human' },
  { id: 'remediation-agents', from: 'remediation', to: 'agent:US', fromSide: 'left', toSide: 'bottom', label: 're-review', dashed: true, tone: 'ai' },
  { id: 'compliance-context', from: 'compliance', to: 'context', fromSide: 'right', toSide: 'right', label: 'logs precedent', dashed: true, tone: 'context' },
];

const TONE_ACTIVE: Record<EdgeSpec['tone'], string> = {
  ai: '#818cf8', // accent / indigo-400
  human: '#34d399', // human / emerald-400
  outcome: '#a1a1ac', // muted
  context: '#71717c', // faint
};

const INACTIVE = '#2a2a31'; // ~border-strong, reads as quiet wiring on the canvas

function anchor(rect: NodeRect, side: Side): Point {
  switch (side) {
    case 'top':
      return { x: rect.x + rect.width / 2, y: rect.y };
    case 'bottom':
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
    case 'left':
      return { x: rect.x, y: rect.y + rect.height / 2 };
    case 'right':
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
  }
}

// Build a smooth path. Vertical edges use a cubic with vertical control
// handles; everything else (the feedback loops) routes through an elbow with
// rounded control points so the lines read as deliberate wiring.
function pathFor(a: Point, b: Point, fromSide: Side, toSide: Side): string {
  const verticalFlow = (fromSide === 'bottom' || fromSide === 'top') && (toSide === 'top' || toSide === 'bottom');
  if (verticalFlow) {
    const dy = (b.y - a.y) * 0.5;
    return `M ${a.x} ${a.y} C ${a.x} ${a.y + dy}, ${b.x} ${b.y - dy}, ${b.x} ${b.y}`;
  }
  // Side-routed feedback / precedent loops: bow outward horizontally.
  const midX = fromSide === 'left' || toSide === 'left' ? Math.min(a.x, b.x) - 48 : Math.max(a.x, b.x) + 48;
  return `M ${a.x} ${a.y} C ${midX} ${a.y}, ${midX} ${b.y}, ${b.x} ${b.y}`;
}

interface DiagramEdgesProps {
  rects: RectMap;
  activeEdges: ReadonlySet<EdgeId>;
  width: number;
  height: number;
}

export function DiagramEdges({ rects, activeEdges, width, height }: DiagramEdgesProps) {
  if (width === 0 || height === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <marker id="arrow-active" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#f4f4f7" />
        </marker>
        <marker id="arrow-idle" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={INACTIVE} />
        </marker>
      </defs>

      {EDGES.map((edge) => {
        const fromRect = rects[edge.from];
        const toRect = rects[edge.to];
        if (!fromRect || !toRect) return null;

        const a = anchor(fromRect, edge.fromSide);
        const b = anchor(toRect, edge.toSide);
        const d = pathFor(a, b, edge.fromSide, edge.toSide);
        const isActive = activeEdges.has(edge.id);
        const stroke = isActive ? TONE_ACTIVE[edge.tone] : INACTIVE;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

        return (
          <Fragment key={edge.id}>
            {/* Base line. */}
            <path
              d={d}
              fill="none"
              stroke={stroke}
              strokeWidth={isActive ? 2.5 : 1.5}
              strokeLinecap="round"
              strokeDasharray={edge.dashed ? '6 6' : undefined}
              markerEnd={`url(#${isActive ? 'arrow-active' : 'arrow-idle'})`}
              opacity={isActive ? 0.95 : 0.5}
            />
            {/* Animated flow overlay only while the edge is lit. */}
            {isActive ? (
              <path
                d={d}
                fill="none"
                stroke="#f8fafc"
                strokeWidth={1.4}
                strokeLinecap="round"
                strokeDasharray="2 22"
                className="animate-dash-flow"
                opacity={0.85}
              />
            ) : null}
            {edge.label ? (
              <g transform={`translate(${mid.x}, ${mid.y})`}>
                <rect
                  x={-edge.label.length * 3.4 - 6}
                  y={-9}
                  width={edge.label.length * 6.8 + 12}
                  height={18}
                  rx={9}
                  fill="#16161b"
                  stroke={isActive ? stroke : INACTIVE}
                  strokeWidth={1}
                  opacity={isActive ? 0.95 : 0.8}
                />
                <text
                  x={0}
                  y={4}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={600}
                  fontFamily="'JetBrains Mono', ui-monospace, monospace"
                  fill={isActive ? '#f4f4f7' : '#a1a1ac'}
                >
                  {edge.label}
                </text>
              </g>
            ) : null}
          </Fragment>
        );
      })}
    </svg>
  );
}
