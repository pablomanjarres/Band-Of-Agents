import type { RegionState } from '../boardState';
import { SeverityChip } from './SeverityChip';
import { StatusChip } from './StatusChip';

export function RegionCard({ region }: { region: RegionState }) {
  const isReviewing = region.status === 'reviewing';

  return (
    <div className="surface flex flex-col rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-mono text-sm font-bold uppercase tracking-wider text-fg">
            {region.region}
          </h3>
          {region.reviewerName ? (
            <p className="mt-0.5 text-xs text-faint">{region.reviewerName}</p>
          ) : null}
        </div>
        <StatusChip status={region.status} />
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs text-muted">
        {isReviewing ? (
          <span className="text-faint">Not validated yet</span>
        ) : (
          <span>
            {region.blocking > 0 ? (
              <span className="font-semibold text-danger">{region.blocking} blocking</span>
            ) : (
              <span className="text-human">No blocking findings</span>
            )}
          </span>
        )}
      </div>

      {region.rationale ? (
        <p className="mt-2 text-xs leading-relaxed text-muted">{region.rationale}</p>
      ) : null}

      {region.findings.length > 0 ? (
        <ul className="mt-3 space-y-2 border-t border-border pt-3">
          {region.findings.map((finding, index) => (
            <li key={`${finding.category}-${index}`} className="text-xs">
              <div className="flex items-center gap-2">
                <SeverityChip severity={finding.severity} />
                <span className="font-medium text-fg">{finding.category}</span>
              </div>
              <p className="mt-1 text-muted">{finding.rationale}</p>
              {finding.requiredDisclosure ? (
                <p className="mt-1 italic text-faint">
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
