import type { MatrixRow } from '../boardState';
import { REGION_ORDER } from '../boardState';
import { VerdictBadge } from './VerdictBadge';

interface CampaignMatrixProps {
  rows: MatrixRow[];
  // Drill into a single material's Live Board when a cell (or row) is clicked.
  onSelect: (materialId: string) => void;
  selectedMaterialId?: string;
}

const KIND_TONE: Record<string, string> = {
  video: 'bg-violet-500/15 text-violet-300 ring-1 ring-inset ring-violet-400/30',
  post: 'bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-400/30',
  image: 'bg-teal-500/15 text-teal-300 ring-1 ring-inset ring-teal-400/30',
  banner: 'bg-warn/15 text-warn ring-1 ring-inset ring-warn/30',
};

// The material x region matrix is the campaign centerpiece: each row is a
// material negotiating CONCURRENTLY (not a pipeline stage), each column a region.
// A cell shows that region's current verdict for that material plus its finding
// count, and clicking it drills into the per-material Live Board.
export function CampaignMatrix({ rows, onSelect, selectedMaterialId }: CampaignMatrixProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border-strong bg-surface/40 p-8 text-center text-sm text-muted">
        No materials yet. Add one to populate the matrix.
      </div>
    );
  }

  return (
    <div className="surface overflow-x-auto rounded-2xl">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-bg-soft/50 text-left">
            <th className="px-4 py-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-faint">
              Material
            </th>
            {REGION_ORDER.map((region) => (
              <th
                key={region}
                className="px-4 py-3 text-center font-mono text-[10px] font-semibold uppercase tracking-wider text-faint"
              >
                {region}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isSelected = row.materialId === selectedMaterialId;
            return (
              <tr
                key={row.materialId}
                className={`border-b border-border last:border-0 ${
                  isSelected ? 'bg-accent/[0.07]' : 'hover:bg-surface-2/60'
                }`}
              >
                <th scope="row" className="px-4 py-3 text-left align-top font-medium">
                  <button
                    type="button"
                    onClick={() => onSelect(row.materialId)}
                    className="group flex flex-col items-start gap-1 text-left"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${
                          KIND_TONE[row.material.kind] ?? 'bg-surface-3 text-muted ring-1 ring-inset ring-border-strong'
                        }`}
                      >
                        {row.material.kind}
                      </span>
                      <span className="text-fg group-hover:text-accent">
                        {row.material.name ?? row.material.id}
                      </span>
                    </span>
                    <span className="max-w-xs truncate text-xs font-normal text-faint">
                      {row.material.claim || row.material.copy}
                    </span>
                  </button>
                </th>
                {REGION_ORDER.map((region) => {
                  const cell = row.cells[region];
                  const status = cell?.status ?? 'reviewing';
                  return (
                    <td key={region} className="px-4 py-3 text-center align-top">
                      <button
                        type="button"
                        onClick={() => onSelect(row.materialId)}
                        className="inline-flex flex-col items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-surface-3"
                        title={cell?.rationale ?? `${region} - ${status}`}
                      >
                        <VerdictBadge status={status} pulse />
                        {cell && (cell.blocking > 0 || cell.findings > 0) ? (
                          <span
                            className={`font-mono text-[10px] font-semibold ${
                              cell.blocking > 0 ? 'text-danger' : 'text-warn'
                            }`}
                          >
                            {cell.blocking > 0
                              ? `${cell.blocking} blocking`
                              : `${cell.findings} finding${cell.findings === 1 ? '' : 's'}`}
                          </span>
                        ) : (
                          <span className="text-[10px] text-faint">-</span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
