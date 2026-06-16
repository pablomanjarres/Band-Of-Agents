import type { Advertisement, VerdictDecision } from '../types';

interface AdvertisementTabsProps {
  advertisements: Advertisement[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  /** Optional worst-case decision per advertisement, for a status dot on each tab. */
  worstByAd?: Record<string, VerdictDecision | undefined>;
}

const DECISION_DOT: Record<VerdictDecision, string> = {
  publish: 'bg-human',
  adapt: 'bg-warn',
  escalate: 'bg-danger',
};

/**
 * Horizontal advertisement tabs (the campaign's ads). Each ad holds its own
 * materials; selecting one shows that ad's materials grid. "+ Advertisement" adds
 * a new ad at any time.
 */
export function AdvertisementTabs({ advertisements, selectedId, onSelect, onAdd, worstByAd }: AdvertisementTabsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {advertisements.map((ad) => {
        const active = ad.id === selectedId;
        const worst = worstByAd?.[ad.id];
        return (
          <button
            key={ad.id}
            type="button"
            onClick={() => onSelect(ad.id)}
            className={`group inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition-all ${
              active
                ? 'border-accent/50 bg-accent/10 text-accent shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]'
                : 'border-border-strong bg-surface/60 text-muted hover:border-border-strong hover:text-fg'
            }`}
          >
            {worst ? <span className={`h-2 w-2 rounded-full ${DECISION_DOT[worst]}`} /> : null}
            <span className="max-w-[12rem] truncate">{ad.name}</span>
            <span className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold ${active ? 'bg-accent/15 text-accent' : 'bg-surface-3 text-faint'}`}>
              {ad.materials.length}
            </span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onAdd}
        className="inline-flex items-center gap-1 rounded-xl border border-dashed border-border-strong px-3.5 py-2 text-sm font-medium text-muted transition-colors hover:border-accent/50 hover:text-fg"
      >
        + Advertisement
      </button>
    </div>
  );
}
