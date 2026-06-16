import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listCampaigns, saveCampaign } from '../api';
import type { CampaignSummary } from '../types';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; campaigns: CampaignSummary[] };

// The campaign library: each campaign is a product, holding several advertisements,
// each with its own materials. A card opens the detail workspace.
export function CampaignsPage() {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let active = true;
    listCampaigns()
      .then((res) => {
        if (active) setLoad({ kind: 'ready', campaigns: res.campaigns });
      })
      .catch((err: unknown) => {
        if (active) setLoad({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to load campaigns.' });
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Campaigns</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            A campaign is a product. Inside it are advertisements; each advertisement has its own
            videos, posts, images, and banners, all reviewed concurrently against one shared dossier.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
        >
          {creating ? 'Cancel' : '+ New campaign'}
        </button>
      </div>

      {creating ? <NewCampaign onCreated={() => setCreating(false)} /> : null}

      {load.kind === 'loading' ? (
        <p className="text-sm text-slate-500">Loading campaigns.</p>
      ) : load.kind === 'error' ? (
        <p className="text-sm text-red-600">{load.message}</p>
      ) : load.campaigns.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No campaigns yet. Create one above, then add advertisements and their materials.
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {load.campaigns.map((campaign) => (
            <li key={campaign.id}>
              <Link
                to={`/campaigns/${encodeURIComponent(campaign.id)}`}
                className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-base font-semibold text-slate-900">{campaign.name}</h2>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 font-semibold text-indigo-700">
                    {campaign.advertisementCount} ad{campaign.advertisementCount === 1 ? '' : 's'}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 font-medium text-slate-600">
                    {campaign.materialCount} material{campaign.materialCount === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {campaign.markets.length > 0 ? (
                    campaign.markets.map((market) => (
                      <span key={market} className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
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

function NewCampaign({ onCreated }: { onCreated: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await saveCampaign({
        name: name.trim(),
        markets: ['US', 'EU', 'LATAM'],
        dossier: { approvedClaims: [], substantiation: '', approvedInfo: '', sources: [] },
        advertisements: [],
      });
      onCreated();
      navigate(`/campaigns/${encodeURIComponent(res.campaign.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create campaign.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Product / campaign name (e.g. Immune+ Q3)"
          className="flex-1 rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-800 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
        <button
          type="button"
          disabled={saving || !name.trim()}
          onClick={() => void create()}
          className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Creating.' : 'Create campaign'}
        </button>
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
