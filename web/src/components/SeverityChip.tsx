import type { Severity } from '../types';

const STYLES: Record<Severity, string> = {
  block: 'bg-red-100 text-red-700 ring-red-200',
  warn: 'bg-amber-100 text-amber-700 ring-amber-200',
  info: 'bg-slate-100 text-slate-600 ring-slate-200',
};

const LABELS: Record<Severity, string> = {
  block: 'Block',
  warn: 'Warn',
  info: 'Info',
};

export function SeverityChip({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ring-1 ring-inset ${STYLES[severity]}`}
    >
      {LABELS[severity]}
    </span>
  );
}
