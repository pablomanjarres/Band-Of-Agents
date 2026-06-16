import { useEffect, useState } from 'react';
import { saveCampaign } from '../api';
import type { Campaign, CampaignDossier, DossierSource } from '../types';
import { Dropzone } from './Dropzone';

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

const labelClass = 'block font-mono text-[10px] font-medium uppercase tracking-wider text-faint';
const inputClass =
  'mt-1.5 w-full rounded-xl border border-border-strong bg-bg-soft/70 p-2 text-sm text-fg placeholder:text-faint transition-colors focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/25';
const cellInputClass =
  'rounded-lg border border-border-strong bg-bg-soft/70 p-1.5 text-sm text-fg placeholder:text-faint transition-colors focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/25';

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

  // Upload a reference file (.md / .json / .txt): read it locally, infer the kind
  // from the extension, and append it as a source. Save persists it to the dossier
  // so it cascades into every material's review.
  async function handleSourceFile(file: File) {
    const text = await file.text();
    const ext = file.name.toLowerCase().split('.').pop();
    const kind: DossierSource['kind'] = ext === 'md' || ext === 'markdown' ? 'md' : ext === 'json' ? 'json' : 'text';
    setSources((prev) => [...prev, { name: file.name, kind, content: text }]);
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
    <section className="surface rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl text-fg">Campaign dossier</h2>
          <p className="mt-0.5 text-xs text-muted">
            The shared source-of-truth. Editing it re-grounds every material&apos;s review.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={save.kind === 'saving'}
          className="btn btn-primary"
        >
          {save.kind === 'saving' ? 'Saving…' : 'Save dossier'}
        </button>
      </div>

      {save.kind === 'saved' ? (
        <p className="mt-3 rounded-xl bg-human/10 px-3 py-2 text-sm text-human ring-1 ring-inset ring-human/25">
          Dossier saved. It cascades into the next review of every material.
        </p>
      ) : null}
      {save.kind === 'error' ? (
        <p className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger ring-1 ring-inset ring-danger/25">
          {save.message}
        </p>
      ) : null}

      <div className="mt-4 space-y-4">
        <div>
          <label className={labelClass} htmlFor="approvedClaims">
            Approved claims <span className="font-normal lowercase text-faint">(one per line)</span>
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
              className="rounded-lg border border-dashed border-border-strong bg-surface/40 px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:border-accent/50 hover:text-fg"
            >
              + Add source
            </button>
          </div>
          <div className="mt-2">
            <Dropzone
              accent="slate"
              accept=".md,.markdown,.json,.txt,text/*,application/json"
              label="Drop a .md / .json / .txt source, or click to choose"
              hint="read locally; Save the dossier to attach it"
              compact
              onFile={handleSourceFile}
            />
          </div>
          {sources.length === 0 ? (
            <p className="mt-2 text-xs text-faint">No reference sources attached.</p>
          ) : (
            <ul className="mt-2 space-y-3">
              {sources.map((src, index) => (
                <li key={index} className="rounded-xl border border-border bg-bg-soft/50 p-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={src.name}
                      onChange={(event) => updateSource(index, { name: event.target.value })}
                      className={`flex-1 ${cellInputClass}`}
                      placeholder="Source name (e.g. EFSA-claims.md)"
                    />
                    <select
                      value={src.kind}
                      onChange={(event) =>
                        updateSource(index, { kind: event.target.value as DossierSource['kind'] })
                      }
                      className={cellInputClass}
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
                      className="rounded-lg px-2 py-1 text-xs font-medium text-danger transition-colors hover:bg-danger/10"
                    >
                      Remove
                    </button>
                  </div>
                  <textarea
                    value={src.content}
                    onChange={(event) => updateSource(index, { content: event.target.value })}
                    rows={2}
                    className={`mt-2 w-full ${cellInputClass}`}
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
