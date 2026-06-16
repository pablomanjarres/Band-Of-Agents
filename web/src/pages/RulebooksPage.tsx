import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getRulebook,
  importRulebook,
  listRulebookPresets,
  listRulebooks,
  saveRulebook,
} from '../api';
import type { Rule, Rulebook, RulebookPreset, Severity } from '../types';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; rulebooks: Rulebook[] };

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

type ImportState =
  | { kind: 'idle' }
  | { kind: 'importing'; what: string }
  | { kind: 'error'; message: string };

// Where the rules currently in the editor came from. A "proposal" (imported file
// or preset) is NOT yet persisted; only Save (PUT) writes it to the store.
type Source =
  | { kind: 'store' }
  | { kind: 'file'; name: string; ruleCount: number }
  | { kind: 'preset'; label: string; ruleCount: number };

const SEVERITY_OPTIONS: Severity[] = ['block', 'warn', 'info'];

const labelClass = 'block text-xs font-medium uppercase tracking-wide text-slate-500';
const inputClass =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-800 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400';
const cellInputClass =
  'w-full rounded-md border border-slate-300 bg-white p-1.5 text-sm text-slate-800 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400';

function blankRule(region: string): Rule {
  return {
    id: `rule-${Math.random().toString(36).slice(2, 8)}`,
    region,
    category: '',
    severity: 'warn',
    check: '',
    requiredDisclosure: null,
  };
}

// Detect the import format from a file's extension. .json validates directly on
// the server (deterministic, no model); .md / anything else is parsed by an LLM.
function formatForFile(name: string): 'md' | 'json' | 'text' {
  const lower = name.toLowerCase();
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'md';
  return 'text';
}

export function RulebooksPage() {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [region, setRegion] = useState<string | null>(null);
  const [draft, setDraft] = useState<Rulebook | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [importState, setImportState] = useState<ImportState>({ kind: 'idle' });
  const [source, setSource] = useState<Source>({ kind: 'store' });
  const [presets, setPresets] = useState<RulebookPreset[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initial load: list of rulebooks (US, EU, LATAM in that order).
  useEffect(() => {
    let active = true;
    listRulebooks()
      .then((res) => {
        if (!active) return;
        setLoad({ kind: 'ready', rulebooks: res.rulebooks });
        const first = res.rulebooks[0];
        if (first) {
          setRegion(first.region);
          setDraft(structuredClone(first));
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        setLoad({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Failed to load rulebooks.',
        });
      });
    return () => {
      active = false;
    };
  }, []);

  // Load the curated presets once for the picker. A failure here is non-fatal:
  // the manual + import paths still work, so we just leave the picker empty.
  useEffect(() => {
    let active = true;
    listRulebookPresets()
      .then((res) => {
        if (active) setPresets(res.presets);
      })
      .catch(() => {
        /* presets are optional; ignore load failures. */
      });
    return () => {
      active = false;
    };
  }, []);

  // When the region changes, fetch the freshest copy of that rulebook to edit.
  // This resets any unsaved proposal back to the stored book for that region.
  useEffect(() => {
    if (!region) return;
    let active = true;
    setSave({ kind: 'idle' });
    setImportState({ kind: 'idle' });
    setSource({ kind: 'store' });
    getRulebook(region)
      .then((res) => {
        if (!active) return;
        setDraft(structuredClone(res.rulebook));
      })
      .catch((err: unknown) => {
        if (!active) return;
        setSave({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Failed to load rulebook.',
        });
      });
    return () => {
      active = false;
    };
  }, [region]);

  const regions = useMemo(
    () => (load.kind === 'ready' ? load.rulebooks : []),
    [load],
  );

  function updateRule(index: number, patch: Partial<Rule>) {
    setDraft((prev) => {
      if (!prev) return prev;
      const rules = prev.rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule));
      return { ...prev, rules };
    });
    setSave({ kind: 'idle' });
  }

  function addRule() {
    setDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, rules: [...prev.rules, blankRule(prev.region)] };
    });
    setSave({ kind: 'idle' });
  }

  function removeRule(index: number) {
    setDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, rules: prev.rules.filter((_, i) => i !== index) };
    });
    setSave({ kind: 'idle' });
  }

  // Reset the editor back to the rulebook currently saved for this region,
  // discarding an imported/preset proposal the user does not want to keep.
  async function discardProposal() {
    if (!region) return;
    setImportState({ kind: 'idle' });
    try {
      const res = await getRulebook(region);
      setDraft(structuredClone(res.rulebook));
      setSource({ kind: 'store' });
      setSave({ kind: 'idle' });
    } catch (err) {
      setSave({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to reload rulebook.',
      });
    }
  }

  // Read a dropped/selected file in the browser, POST it to the import endpoint,
  // and load the returned PROPOSAL into the editable preview (not persisted).
  async function importFile(file: File) {
    if (!region) return;
    setSave({ kind: 'idle' });
    setImportState({ kind: 'importing', what: file.name });
    try {
      const content = await file.text();
      const format = formatForFile(file.name);
      const res = await importRulebook(region, { format, content });
      setDraft(structuredClone(res.rulebook));
      setSource({ kind: 'file', name: file.name, ruleCount: res.rulebook.rules.length });
      setImportState({ kind: 'idle' });
    } catch (err) {
      setImportState({
        kind: 'error',
        message:
          err instanceof Error ? err.message : `Could not import ${file.name}.`,
      });
    }
  }

  function onFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void importFile(file);
    // Allow re-selecting the same file later.
    event.target.value = '';
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void importFile(file);
  }

  // Load a curated preset's rules into the editable preview for review. The
  // preset is re-tagged to the active region so Save applies it as-is.
  function applyPreset(presetId: string) {
    if (!presetId || !draft) return;
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;
    setImportState({ kind: 'idle' });
    setSave({ kind: 'idle' });
    const rules = preset.rulebook.rules.map((rule) => ({ ...rule, region: draft.region }));
    setDraft((prev) => (prev ? { ...prev, rules } : prev));
    setSource({ kind: 'preset', label: preset.label, ruleCount: rules.length });
  }

  async function handleSave() {
    if (!draft) return;
    setSave({ kind: 'saving' });
    // Normalize: blank disclosure -> null, keep notLegalAdvice true.
    const payload: Rulebook = {
      ...draft,
      notLegalAdvice: true,
      rules: draft.rules.map((rule) => ({
        ...rule,
        requiredDisclosure:
          rule.requiredDisclosure && rule.requiredDisclosure.trim()
            ? rule.requiredDisclosure
            : null,
      })),
    };
    try {
      const res = await saveRulebook(payload.region, payload);
      setDraft(structuredClone(res.rulebook));
      setSource({ kind: 'store' });
      setSave({ kind: 'saved' });
    } catch (err) {
      setSave({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to save rulebook.',
      });
    }
  }

  if (load.kind === 'loading') {
    return <p className="text-sm text-slate-500">Loading rulebooks.</p>;
  }

  if (load.kind === 'error') {
    return <p className="text-sm text-red-600">{load.message}</p>;
  }

  const isProposal = source.kind !== 'store';
  const importing = importState.kind === 'importing';
  const saveLabel = isProposal ? 'Save & apply' : 'Save rulebook';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Rulebooks</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            Import a file, start from a preset, or edit by hand. Nothing applies until you save.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={!draft || save.kind === 'saving'}
          className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {save.kind === 'saving' ? 'Saving.' : saveLabel}
        </button>
      </div>

      <div className="flex items-center gap-1 border-b border-slate-200">
        {regions.map((book) => {
          const isActive = book.region === region;
          return (
            <button
              key={book.region}
              type="button"
              onClick={() => setRegion(book.region)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
                isActive
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {book.label}
            </button>
          );
        })}
      </div>

      {/* Quick setup: file import + preset picker. Both load an editable preview. */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Quick setup</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          Drop a rulebook file or pick a preset to populate the editor below for{' '}
          <span className="font-medium text-slate-500">{region}</span>. Review, then save.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {/* Dropzone / file input */}
          <div>
            <span className={labelClass}>Import a file</span>
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click();
              }}
              className={`mt-1 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${
                dragOver
                  ? 'border-indigo-400 bg-indigo-50/60'
                  : 'border-slate-300 bg-slate-50 hover:bg-slate-100'
              } ${importing ? 'pointer-events-none opacity-60' : ''}`}
            >
              <span className="text-sm font-medium text-slate-700">
                {importing ? `Importing ${importState.what}.` : 'Drop a .md or .json file'}
              </span>
              <span className="mt-1 text-xs text-slate-400">
                or click to choose. JSON is exact; Markdown is parsed by AI into rules.
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.markdown,.json,application/json,text/markdown"
                onChange={onFileInputChange}
                className="hidden"
              />
            </div>
            {importState.kind === 'error' ? (
              <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-inset ring-red-200">
                {importState.message}
              </p>
            ) : null}
          </div>

          {/* Preset picker */}
          <div>
            <label className={labelClass} htmlFor="preset-picker">
              Start from a preset
            </label>
            <select
              id="preset-picker"
              value=""
              disabled={presets.length === 0}
              onChange={(event) => applyPreset(event.target.value)}
              className={inputClass}
            >
              <option value="" disabled>
                {presets.length === 0 ? 'No presets available' : 'Choose a preset.'}
              </option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label} ({preset.rulebook.rules.length} rules)
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-slate-400">
              Curated starting points (US FTC, EU health claims, LATAM). Loaded for review, not
              applied until you save.
            </p>
          </div>
        </div>
      </section>

      {/* Banner reflecting the current source / save status. */}
      {source.kind === 'file' ? (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800 ring-1 ring-inset ring-indigo-200">
          <span>
            Previewing <span className="font-semibold">{source.ruleCount}</span> rule
            {source.ruleCount === 1 ? '' : 's'} imported from{' '}
            <span className="font-semibold">{source.name}</span>. Review and save to apply.
          </span>
          <button
            type="button"
            onClick={discardProposal}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100"
          >
            Discard
          </button>
        </div>
      ) : null}
      {source.kind === 'preset' ? (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800 ring-1 ring-inset ring-indigo-200">
          <span>
            Previewing preset <span className="font-semibold">{source.label}</span> (
            {source.ruleCount} rule{source.ruleCount === 1 ? '' : 's'}). Review and save to apply.
          </span>
          <button
            type="button"
            onClick={discardProposal}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100"
          >
            Discard
          </button>
        </div>
      ) : null}

      {save.kind === 'saved' ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-200">
          Rulebook saved. It applies to the next review.
        </p>
      ) : null}
      {save.kind === 'error' ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-200">
          {save.message}
        </p>
      ) : null}

      {!draft ? (
        <p className="text-sm text-slate-500">Loading rulebook.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {isProposal ? 'Editable preview' : 'Rules'} - {draft.rules.length}{' '}
              {draft.rules.length === 1 ? 'rule' : 'rules'}
            </span>
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">
              Not legal advice
            </span>
          </div>

          {draft.rules.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              No rules yet. Import a file, pick a preset, or add one below.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left">
                    <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      ID
                    </th>
                    <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Category
                    </th>
                    <th className="w-28 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Severity
                    </th>
                    <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Check
                    </th>
                    <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Required disclosure
                    </th>
                    <th className="px-3 py-2.5" aria-label="actions" />
                  </tr>
                </thead>
                <tbody>
                  {draft.rules.map((rule, index) => (
                    <tr key={rule.id} className="border-b border-slate-100 align-top last:border-0">
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={rule.id}
                          onChange={(event) => updateRule(index, { id: event.target.value })}
                          className={`${cellInputClass} font-mono text-xs`}
                          aria-label={`Rule ${index + 1} id`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={rule.category}
                          onChange={(event) => updateRule(index, { category: event.target.value })}
                          className={cellInputClass}
                          placeholder="health-claims"
                          aria-label={`Rule ${index + 1} category`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={rule.severity}
                          onChange={(event) =>
                            updateRule(index, { severity: event.target.value as Severity })
                          }
                          className={cellInputClass}
                          aria-label={`Rule ${index + 1} severity`}
                        >
                          {SEVERITY_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <textarea
                          value={rule.check}
                          onChange={(event) => updateRule(index, { check: event.target.value })}
                          rows={2}
                          className={cellInputClass}
                          placeholder="What this rule verifies."
                          aria-label={`Rule ${index + 1} check`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <textarea
                          value={rule.requiredDisclosure ?? ''}
                          onChange={(event) =>
                            updateRule(index, {
                              requiredDisclosure:
                                event.target.value === '' ? null : event.target.value,
                            })
                          }
                          rows={2}
                          className={cellInputClass}
                          placeholder="Disclosure text, if any."
                          aria-label={`Rule ${index + 1} required disclosure`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => removeRule(index)}
                          className="rounded-lg px-2 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button
            type="button"
            onClick={addRule}
            className="inline-flex items-center rounded-lg border border-dashed border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:bg-slate-50"
          >
            + Add rule manually
          </button>
        </div>
      )}
    </div>
  );
}
