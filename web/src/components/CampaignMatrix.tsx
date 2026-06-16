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
  video: 'bg-violet-100 text-violet-700',
  post: 'bg-sky-100 text-sky-700',
  image: 'bg-teal-100 text-teal-700',
  banner: 'bg-amber-100 text-amber-700',
};

// The material x region matrix is the campaign centerpiece: each row is a
// material negotiating CONCURRENTLY (not a pipeline stage), each column a region.
// A cell shows that region's current verdict for that material plus its finding
// count, and clicking it drills into the per-material Live Board.
export function CampaignMatrix({ rows, onSelect, selectedMaterialId }: CampaignMatrixProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        No materials yet. Add one to populate the matrix.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left">
            <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Material
            </th>
            {REGION_ORDER.map((region) => (
              <th
                key={region}
                className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-slate-500"
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
                className={`border-b border-slate-100 last:border-0 ${
                  isSelected ? 'bg-indigo-50/60' : 'hover:bg-slate-50'
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
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          KIND_TONE[row.material.kind] ?? 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {row.material.kind}
                      </span>
                      <span className="text-slate-800 group-hover:text-indigo-700">
                        {row.material.name ?? row.material.id}
                      </span>
                    </span>
                    <span className="max-w-xs truncate text-xs font-normal text-slate-400">
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
                        className="inline-flex flex-col items-center gap-1 rounded-lg px-2 py-1 transition hover:bg-white"
                        title={cell?.rationale ?? `${region} - ${status}`}
                      >
                        <VerdictBadge status={status} pulse />
                        {cell && (cell.blocking > 0 || cell.findings > 0) ? (
                          <span
                            className={`text-[10px] font-semibold ${
                              cell.blocking > 0 ? 'text-red-600' : 'text-amber-600'
                            }`}
                          >
                            {cell.blocking > 0
                              ? `${cell.blocking} blocking`
                              : `${cell.findings} finding${cell.findings === 1 ? '' : 's'}`}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-300">-</span>
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
