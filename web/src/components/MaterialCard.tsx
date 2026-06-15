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
  video: 'bg-violet-100 text-violet-700',
  post: 'bg-sky-100 text-sky-700',
  image: 'bg-teal-100 text-teal-700',
  banner: 'bg-amber-100 text-amber-700',
};

const STATUS_DOT: Record<RegionStatus, string> = {
  reviewing: 'animate-pulse-soft bg-amber-400',
  publish: 'bg-emerald-500',
  adapt: 'bg-amber-500',
  escalate: 'bg-red-500',
};

export function MaterialCard({ material, cells, onClick, selected }: MaterialCardProps) {
  const poster = material.perception?.frames?.[0] ?? material.imageUrl;
  const reviewed = Boolean(cells);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex flex-col overflow-hidden rounded-xl border text-left shadow-sm transition hover:shadow-md ${
        selected ? 'border-indigo-400 ring-2 ring-indigo-200' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <div className="relative aspect-video w-full bg-slate-100">
        {poster ? (
          <img src={poster} alt={material.name ?? material.id} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-300">
            <KindGlyph kind={material.kind} />
          </div>
        )}
        <span className={`absolute left-2 top-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${KIND_TONE[material.kind]}`}>
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
          <p className="truncate text-sm font-semibold text-slate-800">{material.name ?? material.id}</p>
          <p className="mt-0.5 line-clamp-2 text-xs text-slate-400">{material.claim || material.copy || 'no copy'}</p>
        </div>

        <div className="mt-auto flex flex-wrap gap-1.5">
          {REGION_ORDER.map((region) => {
            const cell = cells?.[region];
            const status = cell?.status;
            return (
              <span
                key={region}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-500"
                title={status ? `${region}: ${status}` : `${region}: not reviewed`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${status ? STATUS_DOT[status] : 'bg-slate-300'}`} />
                {region}
                {cell && cell.findings > 0 ? <span className="text-slate-400">{cell.findings}</span> : null}
              </span>
            );
          })}
          {!reviewed ? <span className="text-[10px] text-slate-300">not reviewed</span> : null}
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
