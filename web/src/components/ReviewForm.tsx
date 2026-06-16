import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ContentAsset } from '../types';

const MARKET_OPTIONS = ['US', 'EU', 'LATAM'] as const;
type Market = (typeof MARKET_OPTIONS)[number];

const SAMPLE: CampaignFormValues = {
  name: 'Immune+ VitC',
  copy: 'Immune+ with Vitamin C. Vitamin C contributes to the normal function of the immune system. Feel your best, every day.',
  claim: 'Vitamin C contributes to the normal function of the immune system.',
  channel: 'instagram',
  markets: ['EU'],
  imagePrompt: '',
  substantiation:
    'Uses the EFSA-authorised health-claim wording for vitamin C and the normal function of the immune system; 80 mg per serving (100% NRV).',
};

export interface CampaignFormValues {
  name: string;
  copy: string;
  claim: string;
  channel: string;
  markets: string[];
  imagePrompt: string;
  substantiation: string;
}

// Kept for callers that still import the prior name (e.g. Library prefill mapping).
export type ReviewFormValues = CampaignFormValues;

interface ReviewFormProps {
  // Saves the composed campaign to the library and resolves with the stored asset.
  onSave: (values: CampaignFormValues) => Promise<ContentAsset>;
  initial?: Partial<CampaignFormValues>;
}

function normalizeMarkets(markets: readonly string[] | undefined): Market[] {
  if (!markets) return [];
  return MARKET_OPTIONS.filter((option) => markets.includes(option));
}

export function ReviewForm({ onSave, initial }: ReviewFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [copy, setCopy] = useState(initial?.copy ?? '');
  const [claim, setClaim] = useState(initial?.claim ?? '');
  const [channel, setChannel] = useState(initial?.channel ?? 'instagram');
  const [markets, setMarkets] = useState<Market[]>(normalizeMarkets(initial?.markets));
  const [imagePrompt, setImagePrompt] = useState(initial?.imagePrompt ?? '');
  const [substantiation, setSubstantiation] = useState(initial?.substantiation ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<ContentAsset | null>(null);

  function toggleMarket(market: Market) {
    setMarkets((prev) =>
      prev.includes(market) ? prev.filter((m) => m !== market) : [...prev, market],
    );
  }

  function loadSample() {
    setName(SAMPLE.name);
    setCopy(SAMPLE.copy);
    setClaim(SAMPLE.claim);
    setChannel(SAMPLE.channel);
    setMarkets([...SAMPLE.markets] as Market[]);
    setImagePrompt(SAMPLE.imagePrompt);
    setSubstantiation(SAMPLE.substantiation);
    setError(null);
    setSaved(null);
  }

  function currentValues(): CampaignFormValues {
    return {
      name: name.trim(),
      copy: copy.trim(),
      claim: claim.trim(),
      channel: channel.trim() || 'instagram',
      markets: [...markets],
      imagePrompt: imagePrompt.trim(),
      substantiation: substantiation.trim(),
    };
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError('A campaign name is required.');
      return;
    }
    if (!copy.trim() || !claim.trim()) {
      setError('Copy and claim are required.');
      return;
    }
    if (markets.length === 0) {
      setError('Select at least one market.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const asset = await onSave(currentValues());
      setSaved(asset);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save campaign.');
    } finally {
      setSaving(false);
    }
  }

  const labelClass = 'block text-sm font-medium text-muted';
  const inputClass =
    'mt-1.5 w-full rounded-xl border border-border-strong bg-bg-soft/70 p-2.5 text-sm text-fg placeholder:text-faint transition-colors focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/25';

  if (saved) {
    const savedName = saved.name ?? currentValues().name;
    return (
      <SuccessPanel
        name={savedName}
        onComposeAnother={() => {
          setSaved(null);
          setName('');
          setCopy('');
          setClaim('');
          setChannel('instagram');
          setMarkets([]);
          setImagePrompt('');
          setSubstantiation('');
        }}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl text-fg">Campaign details</h2>
        <button type="button" onClick={loadSample} className="btn btn-ghost">
          Load sample
        </button>
      </div>

      <div>
        <label className={labelClass} htmlFor="name">
          Campaign name
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={inputClass}
          placeholder="e.g. Immune+ Q3"
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="copy">
          Copy
        </label>
        <textarea
          id="copy"
          value={copy}
          onChange={(event) => setCopy(event.target.value)}
          rows={4}
          className={inputClass}
          placeholder="The marketing copy to review."
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="claim">
          Claim
        </label>
        <input
          id="claim"
          type="text"
          value={claim}
          onChange={(event) => setClaim(event.target.value)}
          className={inputClass}
          placeholder="The central claim being made."
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="channel">
            Channel
          </label>
          <input
            id="channel"
            type="text"
            value={channel}
            onChange={(event) => setChannel(event.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <span className={labelClass}>Markets</span>
          <div className="mt-2 flex flex-wrap gap-3">
            {MARKET_OPTIONS.map((market) => {
              const checked = markets.includes(market);
              return (
                <label
                  key={market}
                  className={[
                    'inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-sm font-medium transition-all',
                    checked
                      ? 'border-accent/50 bg-accent/10 text-accent'
                      : 'border-border-strong bg-bg-soft/60 text-muted hover:border-border-strong hover:text-fg',
                  ].join(' ')}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleMarket(market)}
                    className="h-4 w-4 rounded border-border-strong bg-bg-soft text-accent-strong focus:ring-accent/40 focus:ring-offset-0"
                  />
                  {market}
                </label>
              );
            })}
          </div>
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="imagePrompt">
          Image prompt <span className="font-normal text-faint">(optional)</span>
        </label>
        <textarea
          id="imagePrompt"
          value={imagePrompt}
          onChange={(event) => setImagePrompt(event.target.value)}
          rows={2}
          className={inputClass}
          placeholder="Describe the creative to generate."
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="substantiation">
          Substantiation <span className="font-normal text-faint">(optional)</span>
        </label>
        <textarea
          id="substantiation"
          value={substantiation}
          onChange={(event) => setSubstantiation(event.target.value)}
          rows={3}
          className={inputClass}
          placeholder="Evidence backing the claim."
        />
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button type="submit" disabled={saving} className="btn btn-primary px-5 py-2.5">
          {saving ? 'Saving…' : 'Save campaign'}
        </button>
      </div>
    </form>
  );
}

interface SuccessPanelProps {
  name: string;
  onComposeAnother: () => void;
}

function SuccessPanel({ name, onComposeAnother }: SuccessPanelProps) {
  const instruction = `Coordinator, review campaign ${name}`;
  const [copied, setCopied] = useState(false);

  async function copyInstruction() {
    try {
      await navigator.clipboard.writeText(instruction);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable; the text stays visible to copy manually.
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-human/30 bg-human/[0.07] p-5 shadow-[inset_0_1px_0_rgb(255_255_255/0.04),0_0_32px_-14px_rgb(52_211_153/0.5)]">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-human/15 text-human ring-1 ring-inset ring-human/30">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden>
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
          <h2 className="font-display text-xl text-fg">
            Campaign “{name}” saved to the library.
          </h2>
        </div>
        <p className="mt-3 text-sm text-muted">
          To run the review, hand it to the agents in band.ai. Open the room, then post to the
          Coordinator:
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <code className="flex-1 rounded-xl border border-human/25 bg-bg-soft/70 px-3 py-2 font-mono text-sm text-fg">
            “{instruction}”
          </code>
          <button
            type="button"
            onClick={copyInstruction}
            className="btn border border-human/40 bg-human/10 text-human hover:bg-human/15"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="mt-3 text-xs text-faint">
          The agents collaborate in band.ai. The review then appears under Reviews here
          automatically.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onComposeAnother} className="btn btn-primary px-5 py-2.5">
          Compose another
        </button>
        <Link to="/library" className="btn btn-ghost px-5 py-2.5">
          View Library
        </Link>
      </div>
    </div>
  );
}
