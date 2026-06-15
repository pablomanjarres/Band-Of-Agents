import { useEffect, useMemo, useState } from 'react';
import { getRulebook, listRulebooks, saveRulebook } from '../api';
import type { Rule, Rulebook, Severity } from '../types';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; rulebooks: Rulebook[] };

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

const SEVERITY_OPTIONS: Severity[] = ['block', 'warn', 'info'];

const labelClass = 'block font-mono text-[10px] font-medium uppercase tracking-wider text-faint';
const inputClass =
  'mt-1.5 w-full rounded-xl border border-border-strong bg-bg-soft/70 p-2 text-sm text-fg placeholder:text-faint transition-colors focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/25';

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

export function RulebooksPage() {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [region, setRegion] = useState<string | null>(null);
  const [draft, setDraft] = useState<Rulebook | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });

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

  // When the region changes, fetch the freshest copy of that rulebook to edit.
  useEffect(() => {
    if (!region) return;
    let active = true;
    setSave({ kind: 'idle' });
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
      setSave({ kind: 'saved' });
    } catch (err) {
      setSave({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to save rulebook.',
      });
    }
  }

  if (load.kind === 'loading') {
    return <p className="text-sm text-muted">Loading rulebooks…</p>;
  }

  if (load.kind === 'error') {
    return <p className="text-sm text-danger">{load.message}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-2.5">Governance</p>
          <h1 className="font-display text-4xl leading-none text-fg">Rulebooks</h1>
          <p className="mt-2 text-sm text-muted">Edits apply to the next review.</p>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={!draft || save.kind === 'saving'}
          className="btn btn-primary shrink-0"
        >
          {save.kind === 'saving' ? 'Saving…' : 'Save rulebook'}
        </button>
      </div>

      <div className="flex items-center gap-1 border-b border-border">
        {regions.map((book) => {
          const isActive = book.region === region;
          return (
            <button
              key={book.region}
              type="button"
              onClick={() => setRegion(book.region)}
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-accent text-fg'
                  : 'border-transparent text-muted hover:text-fg'
              }`}
            >
              {book.label}
            </button>
          );
        })}
      </div>

      {save.kind === 'saved' ? (
        <p className="rounded-xl bg-human/10 px-3 py-2 text-sm text-human ring-1 ring-inset ring-human/25">
          Rulebook saved. It applies to the next review.
        </p>
      ) : null}
      {save.kind === 'error' ? (
        <p className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger ring-1 ring-inset ring-danger/25">
          {save.message}
        </p>
      ) : null}

      {!draft ? (
        <p className="text-sm text-muted">Loading rulebook…</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-faint">
              {draft.rules.length} {draft.rules.length === 1 ? 'rule' : 'rules'}
            </span>
            <span className="inline-flex items-center rounded-full bg-surface-3 px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-muted ring-1 ring-inset ring-border-strong">
              Not legal advice
            </span>
          </div>

          {draft.rules.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border-strong bg-surface/40 p-10 text-center text-sm text-muted">
              No rules yet. Add one below.
            </div>
          ) : (
            <ul className="space-y-4">
              {draft.rules.map((rule, index) => (
                <li key={rule.id} className="surface rounded-2xl p-4">
                  <div className="flex items-center justify-between gap-3">
                    <code className="rounded bg-surface-3 px-2 py-0.5 font-mono text-xs font-medium text-muted ring-1 ring-inset ring-border-strong">
                      {rule.id}
                    </code>
                    <button
                      type="button"
                      onClick={() => removeRule(index)}
                      className="rounded-lg px-2 py-1 text-xs font-medium text-danger transition-colors hover:bg-danger/10"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className={labelClass} htmlFor={`category-${rule.id}`}>
                        Category
                      </label>
                      <input
                        id={`category-${rule.id}`}
                        type="text"
                        value={rule.category}
                        onChange={(event) => updateRule(index, { category: event.target.value })}
                        className={inputClass}
                        placeholder="e.g. health-claims"
                      />
                    </div>
                    <div>
                      <label className={labelClass} htmlFor={`severity-${rule.id}`}>
                        Severity
                      </label>
                      <select
                        id={`severity-${rule.id}`}
                        value={rule.severity}
                        onChange={(event) =>
                          updateRule(index, { severity: event.target.value as Severity })
                        }
                        className={inputClass}
                      >
                        {SEVERITY_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="mt-3">
                    <label className={labelClass} htmlFor={`check-${rule.id}`}>
                      Check
                    </label>
                    <textarea
                      id={`check-${rule.id}`}
                      value={rule.check}
                      onChange={(event) => updateRule(index, { check: event.target.value })}
                      rows={2}
                      className={inputClass}
                      placeholder="What this rule verifies."
                    />
                  </div>

                  <div className="mt-3">
                    <label className={labelClass} htmlFor={`disclosure-${rule.id}`}>
                      Required disclosure{' '}
                      <span className="font-normal lowercase text-faint">(optional)</span>
                    </label>
                    <input
                      id={`disclosure-${rule.id}`}
                      type="text"
                      value={rule.requiredDisclosure ?? ''}
                      onChange={(event) =>
                        updateRule(index, {
                          requiredDisclosure: event.target.value === '' ? null : event.target.value,
                        })
                      }
                      className={inputClass}
                      placeholder="Disclosure text to require, if any."
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={addRule}
            className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-border-strong bg-surface/40 px-4 py-2 text-sm font-medium text-muted transition-colors hover:border-accent/50 hover:text-fg"
          >
            + Add rule
          </button>
        </div>
      )}
    </div>
  );
}
