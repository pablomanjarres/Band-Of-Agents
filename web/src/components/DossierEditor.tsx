import { useEffect, useState } from 'react';
import { saveCampaign } from '../api';
import type { Campaign, CampaignDossier, DossierSource } from '../types';

interface DossierEditorProps {
  campaign: Campaign;
  // Bubble the saved campaign up so the parent refreshes its copy.
  onSaved: (campaign: Campaign) => void;
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

const SOURCE_KINDS: DossierSource['kind'][] = ['md', 'json', 'text'];

const labelClass = 'block text-xs font-medium uppercase tracking-wide text-slate-500';
const inputClass =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-800 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400';

// One line per approved claim keeps the editor simple; blank lines are dropped.
function claimsToText(claims: string[]): string {
  return claims.join('\n');
}
function textToClaims(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// The dossier is the cascading source-of-truth: editing it here re-grounds every
// material's review (the backend injects it into each reviewer prompt). We edit a
// local draft and POST the whole campaign so the change persists for the next run.
export function DossierEditor({ campaign, onSaved }: DossierEditorProps) {
  const [claimsText, setClaimsText] = useState(claimsToText(campaign.dossier.approvedClaims));
  const [substantiation, setSubstantiation] = useState(campaign.dossier.substantiation);
  const [approvedInfo, setApprovedInfo] = useState(campaign.dossier.approvedInfo);
  const [sources, setSources] = useState<DossierSource[]>(campaign.dossier.sources);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });

  // Re-seed the draft if the parent swaps in a freshly loaded campaign.
  useEffect(() => {
    setClaimsText(claimsToText(campaign.dossier.approvedClaims));
    setSubstantiation(campaign.dossier.substantiation);
    setApprovedInfo(campaign.dossier.approvedInfo);
    setSources(campaign.dossier.sources);
    setSave({ kind: 'idle' });
  }, [campaign.id]);

  function updateSource(index: number, patch: Partial<DossierSource>) {
    setSources((prev) => prev.map((src, i) => (i === index ? { ...src, ...patch } : src)));
    setSave({ kind: 'idle' });
  }
  function addSource() {
    setSources((prev) => [...prev, { name: '', kind: 'text', content: '' }]);
    setSave({ kind: 'idle' });
  }
  function removeSource(index: number) {
    setSources((prev) => prev.filter((_, i) => i !== index));
    setSave({ kind: 'idle' });
  }

  async function handleSave() {
    setSave({ kind: 'saving' });
    const dossier: CampaignDossier = {
      approvedClaims: textToClaims(claimsText),
      substantiation: substantiation.trim(),
      approvedInfo: approvedInfo.trim(),
      sources: sources
        .map((src) => ({ ...src, name: src.name.trim() }))
        .filter((src) => src.name.length > 0 || src.content.trim().length > 0),
    };
    try {
      const res = await saveCampaign({ ...campaign, dossier });
      onSaved(res.campaign);
      setSave({ kind: 'saved' });
    } catch (err) {
      setSave({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to save dossier.' });
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Campaign dossier</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            The shared source-of-truth. Editing it re-grounds every material&apos;s review.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={save.kind === 'saving'}
          className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {save.kind === 'saving' ? 'Saving.' : 'Save dossier'}
        </button>
      </div>

      {save.kind === 'saved' ? (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-200">
          Dossier saved. It cascades into the next review of every material.
        </p>
      ) : null}
      {save.kind === 'error' ? (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-200">
          {save.message}
        </p>
      ) : null}

      <div className="mt-4 space-y-4">
        <div>
          <label className={labelClass} htmlFor="approvedClaims">
            Approved claims <span className="font-normal lowercase text-slate-400">(one per line)</span>
          </label>
          <textarea
            id="approvedClaims"
            value={claimsText}
            onChange={(event) => {
              setClaimsText(event.target.value);
              setSave({ kind: 'idle' });
            }}
            rows={4}
            className={inputClass}
            placeholder="Vitamin C contributes to the normal function of the immune system."
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="substantiation">
            Substantiation
          </label>
          <textarea
            id="substantiation"
            value={substantiation}
            onChange={(event) => {
              setSubstantiation(event.target.value);
              setSave({ kind: 'idle' });
            }}
            rows={3}
            className={inputClass}
            placeholder="Trials, data on file, regulatory facts backing the claims."
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="approvedInfo">
            Approved info
          </label>
          <textarea
            id="approvedInfo"
            value={approvedInfo}
            onChange={(event) => {
              setApprovedInfo(event.target.value);
              setSave({ kind: 'idle' });
            }}
            rows={3}
            className={inputClass}
            placeholder="Approved messaging and mandatory information the materials should carry."
          />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <span className={labelClass}>Sources</span>
            <button
              type="button"
              onClick={addSource}
              className="rounded-lg border border-dashed border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
            >
              + Add source
            </button>
          </div>
          {sources.length === 0 ? (
            <p className="mt-2 text-xs text-slate-400">No reference sources attached.</p>
          ) : (
            <ul className="mt-2 space-y-3">
              {sources.map((src, index) => (
                <li key={index} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={src.name}
                      onChange={(event) => updateSource(index, { name: event.target.value })}
                      className="flex-1 rounded-lg border border-slate-300 bg-white p-1.5 text-sm text-slate-800 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      placeholder="Source name (e.g. EFSA-claims.md)"
                    />
                    <select
                      value={src.kind}
                      onChange={(event) =>
                        updateSource(index, { kind: event.target.value as DossierSource['kind'] })
                      }
                      className="rounded-lg border border-slate-300 bg-white p-1.5 text-sm text-slate-800 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    >
                      {SOURCE_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {kind}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeSource(index)}
                      className="rounded-lg px-2 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                    >
                      Remove
                    </button>
                  </div>
                  <textarea
                    value={src.content}
                    onChange={(event) => updateSource(index, { content: event.target.value })}
                    rows={2}
                    className="mt-2 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-800 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    placeholder="Source content excerpt the reviewers should ground on."
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
