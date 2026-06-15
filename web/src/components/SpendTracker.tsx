import { useEffect, useRef, useState } from 'react';
import { fetchSpending } from '../api';
import type { Spending } from '../types';

// Format a USD figure with enough precision to show small running costs.
function usd(n: number): string {
  if (n > 0 && n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

// Compact header chip showing the live estimated model spend, with a collapsible
// per-model breakdown. Polls /api/spending every 3s. Estimates only (see
// src/models/spend.ts), so the figure is labelled "(est.)".
export function SpendTracker() {
  const [spending, setSpending] = useState<Spending | null>(null);
  const [open, setOpen] = useState(false);
  const failedRef = useRef(false);

  useEffect(() => {
    let active = true;
    const load = () => {
      void fetchSpending()
        .then((s) => {
          if (active) {
            setSpending(s);
            failedRef.current = false;
          }
        })
        .catch(() => {
          if (active) failedRef.current = true;
        });
    };
    load();
    const timer = setInterval(load, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  if (!spending) return null;

  const total = spending.totalUsd;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200 transition hover:bg-emerald-100"
        title="Estimated model spend since the server started"
      >
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        {usd(total)} spent (est.)
        <span className="text-emerald-400">{spending.calls} calls</span>
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">By model</span>
            <span className="text-xs text-slate-400">estimate</span>
          </div>
          {spending.byModel.length === 0 ? (
            <p className="text-xs text-slate-500">No model calls yet.</p>
          ) : (
            <ul className="space-y-1">
              {spending.byModel.map((m) => (
                <li key={m.model} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-slate-600" title={m.model}>
                    {m.model}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-slate-400">{m.calls}x</span>
                    <span className="font-semibold text-slate-700">{usd(m.usd)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
            Rough public list prices, not billing-accurate.
          </div>
        </div>
      ) : null}
    </div>
  );
}
