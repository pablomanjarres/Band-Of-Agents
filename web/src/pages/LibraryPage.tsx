import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { listAssets } from '../api';
import { assetToFormValues } from './NewReviewPage';
import type { ContentAsset } from '../types';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; assets: ContentAsset[] };

export function LibraryPage() {
  const navigate = useNavigate();
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    listAssets()
      .then((res) => {
        if (active) setLoad({ kind: 'ready', assets: res.assets });
      })
      .catch((err: unknown) => {
        if (active) {
          setLoad({
            kind: 'error',
            message: err instanceof Error ? err.message : 'Failed to load library.',
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  function useInCompose(asset: ContentAsset) {
    navigate('/', { state: { prefill: assetToFormValues(asset) } });
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow mb-2.5">Library</p>
        <h1 className="font-display text-4xl leading-none text-fg">Campaign library</h1>
        <p className="mt-2 text-sm text-muted">
          Saved campaigns the band.ai agents review by name. Compose new ones from the Compose tab.
        </p>
      </div>

      {load.kind === 'loading' ? (
        <p className="text-sm text-muted">Loading library…</p>
      ) : load.kind === 'error' ? (
        <p className="text-sm text-danger">{load.message}</p>
      ) : load.assets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border-strong bg-surface/40 p-10 text-center text-sm text-muted">
          No saved campaigns yet. Use “Save campaign” on the Compose tab.
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {load.assets.map((asset, index) => (
            <li
              key={asset.id}
              className="rise surface group flex flex-col rounded-2xl p-5 transition-colors hover:border-border-strong"
              style={{ '--d': `${index * 60}ms` } as CSSProperties}
            >
              {asset.name ? (
                <h2 className="font-display text-lg text-fg">{asset.name}</h2>
              ) : null}

              <div className={`flex flex-wrap items-center gap-2 ${asset.name ? 'mt-2' : ''}`}>
                <span className="inline-flex items-center rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent ring-1 ring-inset ring-accent/25">
                  {asset.channel}
                </span>
                {asset.markets.map((market) => (
                  <span
                    key={market}
                    className="inline-flex items-center rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-muted ring-1 ring-inset ring-border-strong"
                  >
                    {market}
                  </span>
                ))}
              </div>

              <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-fg/90">{asset.copy}</p>

              <p className="mt-3 text-xs text-faint">
                <span className="font-semibold text-muted">Claim:</span> {asset.claim}
              </p>

              <button
                type="button"
                onClick={() => useInCompose(asset)}
                className="btn btn-ghost mt-4 self-start px-3 py-1.5"
              >
                Edit in Compose
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
