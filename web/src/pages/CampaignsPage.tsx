import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
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
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="eyebrow mb-2.5">Workspace</p>
          <h1 className="font-display text-4xl leading-none text-fg sm:text-5xl">Campaigns</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            A campaign is a product. Inside it are advertisements; each advertisement has its own
            videos, posts, images, and banners, all reviewed concurrently against one shared dossier.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className={creating ? 'btn btn-ghost' : 'btn btn-primary'}
        >
          {creating ? 'Cancel' : '+ New campaign'}
        </button>
      </div>

      {creating ? <NewCampaign onCreated={() => setCreating(false)} /> : null}

      {load.kind === 'loading' ? (
        <p className="text-sm text-muted">Loading campaigns…</p>
      ) : load.kind === 'error' ? (
        <p className="text-sm text-danger">{load.message}</p>
      ) : load.campaigns.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border-strong bg-surface/40 p-10 text-center text-sm text-muted">
          No campaigns yet. Create one above, then add advertisements and their materials.
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {load.campaigns.map((campaign, index) => (
            <li key={campaign.id}>
              <Link
                to={`/campaigns/${encodeURIComponent(campaign.id)}`}
                className="rise surface group flex h-full flex-col rounded-2xl p-5 transition-all hover:-translate-y-0.5 hover:border-border-strong"
                style={{ '--d': `${index * 55}ms` } as CSSProperties}
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-display text-xl text-fg">{campaign.name}</h2>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center rounded-full bg-accent/10 px-2.5 py-0.5 font-semibold text-accent ring-1 ring-inset ring-accent/25">
                    {campaign.advertisementCount} ad{campaign.advertisementCount === 1 ? '' : 's'}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-surface-3 px-2.5 py-0.5 font-medium text-muted ring-1 ring-inset ring-border-strong">
                    {campaign.materialCount} material{campaign.materialCount === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {campaign.markets.length > 0 ? (
                    campaign.markets.map((market) => (
                      <span
                        key={market}
                        className="inline-flex items-center rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-muted ring-1 ring-inset ring-border-strong"
                      >
                        {market}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-faint">no default markets</span>
                  )}
                </div>
                <span className="mt-4 inline-flex items-center gap-1 self-start text-sm font-medium text-accent">
                  Open campaign
                  <span className="transition-transform group-hover:translate-x-0.5">→</span>
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
    <div className="surface rounded-2xl p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Product / campaign name (e.g. Immune+ Q3)"
          className="flex-1 rounded-xl border border-border-strong bg-bg-soft/70 p-2.5 text-sm text-fg placeholder:text-faint transition-colors focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
        <button
          type="button"
          disabled={saving || !name.trim()}
          onClick={() => void create()}
          className="btn btn-primary"
        >
          {saving ? 'Creating…' : 'Create campaign'}
        </button>
      </div>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
    </div>
  );
}
