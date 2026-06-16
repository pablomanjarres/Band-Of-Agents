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
  publish: 'bg-emerald-500',
  adapt: 'bg-amber-500',
  escalate: 'bg-red-500',
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
            className={`group inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium shadow-sm transition ${
              active
                ? 'border-indigo-300 bg-indigo-50 text-indigo-800'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            {worst ? <span className={`h-2 w-2 rounded-full ${DECISION_DOT[worst]}`} /> : null}
            <span className="max-w-[12rem] truncate">{ad.name}</span>
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${active ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>
              {ad.materials.length}
            </span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onAdd}
        className="inline-flex items-center gap-1 rounded-xl border border-dashed border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-500 transition hover:border-indigo-300 hover:text-indigo-600"
      >
        + Advertisement
      </button>
    </div>
  );
}
