import { REGION_ORDER, type MatrixCell, type RegionStatus } from '../boardState';
import type { Material, MaterialKind } from '../types';

interface MaterialCardProps {
  material: Material;
  /** Per-region cells from the matrix row (status + finding counts). */
  cells?: Record<string, MatrixCell>;
  onClick: () => void;
  selected?: boolean;
}

const KIND_TONE: Record<MaterialKind, string> = {
  video: 'bg-violet-500/15 text-violet-300 ring-1 ring-inset ring-violet-400/30',
  post: 'bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-400/30',
  image: 'bg-teal-500/15 text-teal-300 ring-1 ring-inset ring-teal-400/30',
  banner: 'bg-warn/15 text-warn ring-1 ring-inset ring-warn/30',
};

const STATUS_DOT: Record<RegionStatus, string> = {
  reviewing: 'bg-faint',
  publish: 'bg-human',
  adapt: 'bg-warn',
  escalate: 'bg-danger',
};

export function MaterialCard({ material, cells, onClick, selected }: MaterialCardProps) {
  const poster = material.perception?.frames?.[0] ?? material.imageUrl;
  const reviewed = Boolean(cells);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`surface group flex flex-col overflow-hidden rounded-2xl text-left transition-all hover:-translate-y-0.5 ${
        selected ? 'border-accent/60 ring-2 ring-accent/25' : 'hover:border-border-strong'
      }`}
    >
      <div className="relative aspect-video w-full bg-bg-soft">
        {poster ? (
          <img src={poster} alt={material.name ?? material.id} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-faint">
            <KindGlyph kind={material.kind} />
          </div>
        )}
        <span className={`absolute left-2 top-2 inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${KIND_TONE[material.kind]}`}>
          {material.kind}
        </span>
        {material.videoUrl ? (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
            video
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div>
          <p className="truncate text-sm font-semibold text-fg">{material.name ?? material.id}</p>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted">{material.claim || material.copy || 'no copy'}</p>
        </div>

        <div className="mt-auto flex flex-wrap gap-1.5">
          {REGION_ORDER.map((region) => {
            const cell = cells?.[region];
            const status = cell?.status;
            return (
              <span
                key={region}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-soft/60 px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted"
                title={status && status !== 'reviewing' ? `${region}: ${status}` : `${region}: not validated`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${status ? STATUS_DOT[status] : 'bg-surface-3'}`} />
                {region}
                {cell && cell.findings > 0 ? <span className="text-faint">{cell.findings}</span> : null}
              </span>
            );
          })}
          {!reviewed ? <span className="text-[10px] text-faint">not validated</span> : null}
        </div>
      </div>
    </button>
  );
}

function KindGlyph({ kind }: { kind: MaterialKind }) {
  const path =
    kind === 'video'
      ? 'M10 8l6 4-6 4V8z'
      : kind === 'image'
        ? 'M4 16l4-4 3 3 5-5 4 4M4 6h16v12H4z'
        : 'M5 5h14M5 10h14M5 15h9';
  return (
    <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}
