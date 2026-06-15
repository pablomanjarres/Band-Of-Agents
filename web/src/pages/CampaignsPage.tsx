import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listCampaigns } from '../api';
import type { CampaignSummary } from '../types';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; campaigns: CampaignSummary[] };

// The campaign library: each card opens the detail page where the dossier, the
// nested materials, and the live material x region matrix live. The aggregate
// verdict is computed live on the detail page (from the concurrent per-material
// negotiation), so the card shows the campaign shape (materials + markets).
export function CampaignsPage() {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    listCampaigns()
      .then((res) => {
        if (active) setLoad({ kind: 'ready', campaigns: res.campaigns });
      })
      .catch((err: unknown) => {
        if (active) {
          setLoad({
            kind: 'error',
            message: err instanceof Error ? err.message : 'Failed to load campaigns.',
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Campaigns</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            A campaign is a product: many materials reviewed concurrently against one shared dossier.
          </p>
        </div>
        <Link
          to="/"
          className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
        >
          + Compose
        </Link>
      </div>

      {load.kind === 'loading' ? (
        <p className="text-sm text-slate-500">Loading campaigns.</p>
      ) : load.kind === 'error' ? (
        <p className="text-sm text-red-600">{load.message}</p>
      ) : load.campaigns.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No campaigns yet. Compose one on the Compose tab; it appears here as a one-material
          campaign you can grow.
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {load.campaigns.map((campaign) => (
            <li key={campaign.id}>
              <Link
                to={`/campaigns/${encodeURIComponent(campaign.id)}`}
                className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-sm font-semibold text-slate-900">{campaign.name}</h2>
                  <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
                    {campaign.materialCount}{' '}
                    {campaign.materialCount === 1 ? 'material' : 'materials'}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {campaign.markets.length > 0 ? (
                    campaign.markets.map((market) => (
                      <span
                        key={market}
                        className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
                      >
                        {market}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-slate-400">no default markets</span>
                  )}
                </div>
                <span className="mt-4 inline-flex items-center self-start text-sm font-semibold text-indigo-600">
                  Open campaign &rarr;
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
