import type { RegionState } from '../boardState';
import { SeverityChip } from './SeverityChip';
import { StatusChip } from './StatusChip';

export function RegionCard({ region }: { region: RegionState }) {
  const isReviewing = region.status === 'reviewing';

  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">
            {region.region}
          </h3>
          {region.reviewerName ? (
            <p className="text-xs text-slate-400">{region.reviewerName}</p>
          ) : null}
        </div>
        <StatusChip status={region.status} />
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
        {isReviewing ? (
          <span className="text-slate-400">Reviewing.</span>
        ) : (
          <span>
            {region.blocking > 0 ? (
              <span className="font-semibold text-red-600">{region.blocking} blocking</span>
            ) : (
              <span className="text-emerald-600">No blocking findings</span>
            )}
          </span>
        )}
      </div>

      {region.rationale ? (
        <p className="mt-2 text-xs leading-relaxed text-slate-500">{region.rationale}</p>
      ) : null}

      {region.findings.length > 0 ? (
        <ul className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          {region.findings.map((finding, index) => (
            <li key={`${finding.category}-${index}`} className="text-xs">
              <div className="flex items-center gap-2">
                <SeverityChip severity={finding.severity} />
                <span className="font-medium text-slate-700">{finding.category}</span>
              </div>
              <p className="mt-1 text-slate-500">{finding.rationale}</p>
              {finding.requiredDisclosure ? (
                <p className="mt-1 italic text-slate-400">
                  Required disclosure: {finding.requiredDisclosure}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
