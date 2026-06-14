import { useEffect, useState } from 'react';
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

  function useInNewReview(asset: ContentAsset) {
    navigate('/', { state: { prefill: assetToFormValues(asset) } });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Asset library</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            Reusable copy and claims. Save new assets from the New Review form.
          </p>
        </div>
      </div>

      {load.kind === 'loading' ? (
        <p className="text-sm text-slate-500">Loading library.</p>
      ) : load.kind === 'error' ? (
        <p className="text-sm text-red-600">{load.message}</p>
      ) : load.assets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No saved assets yet. Use "Save to library" on the New Review form.
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {load.assets.map((asset) => (
            <li
              key={asset.id}
              className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
                  {asset.channel}
                </span>
                {asset.markets.map((market) => (
                  <span
                    key={market}
                    className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
                  >
                    {market}
                  </span>
                ))}
              </div>

              <p className="mt-3 line-clamp-3 text-sm text-slate-800">{asset.copy}</p>

              <p className="mt-3 text-xs text-slate-500">
                <span className="font-semibold text-slate-600">Claim:</span> {asset.claim}
              </p>

              <button
                type="button"
                onClick={() => useInNewReview(asset)}
                className="mt-4 inline-flex items-center self-start rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
              >
                Use in new review
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
