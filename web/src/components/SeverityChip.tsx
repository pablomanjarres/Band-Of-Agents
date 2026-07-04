import type { Severity } from '../types';

const STYLES: Record<Severity, string> = {
  block: 'bg-danger/10 text-danger ring-danger/25',
  warn: 'bg-warn/10 text-warn ring-warn/25',
  info: 'bg-surface-3 text-muted ring-border-strong',
};

const LABELS: Record<Severity, string> = {
  block: 'Block',
  warn: 'Warn',
  info: 'Info',
};

// Blocking / warning severities pulse a tone glow; "info" stays quiet.
const GLOW: Record<Severity, string> = {
  block: 'glow-badge glow-danger',
  warn: 'glow-badge glow-amber',
  info: '',
};

export function SeverityChip({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${STYLES[severity]} ${GLOW[severity]}`}
    >
      {LABELS[severity]}
    </span>
  );
}
