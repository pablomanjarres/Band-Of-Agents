import { useState } from 'react';
import type { CreateReviewRequest } from '../types';

const MARKET_OPTIONS = ['US', 'EU', 'LATAM'] as const;
type Market = (typeof MARKET_OPTIONS)[number];

const SAMPLE: CreateReviewRequest = {
  copy: 'Lumavida Immune+ with Vitamin C. Vitamin C contributes to the normal function of the immune system. Feel your best, every day.',
  claim: 'Vitamin C contributes to the normal function of the immune system.',
  channel: 'instagram',
  markets: ['EU'],
  imagePrompt: '',
  substantiation:
    'Uses the EFSA-authorised health-claim wording for vitamin C and the normal function of the immune system; 80 mg per serving (100% NRV).',
};

export interface ReviewFormValues {
  copy: string;
  claim: string;
  channel: string;
  markets: string[];
  imagePrompt: string;
  substantiation: string;
}

interface ReviewFormProps {
  onSubmit: (body: CreateReviewRequest) => Promise<void>;
  initial?: Partial<ReviewFormValues>;
  onSaveToLibrary?: (values: ReviewFormValues) => Promise<void>;
}

function normalizeMarkets(markets: readonly string[] | undefined): Market[] {
  if (!markets) return [];
  return MARKET_OPTIONS.filter((option) => markets.includes(option));
}

export function ReviewForm({ onSubmit, initial, onSaveToLibrary }: ReviewFormProps) {
  const [copy, setCopy] = useState(initial?.copy ?? '');
  const [claim, setClaim] = useState(initial?.claim ?? '');
  const [channel, setChannel] = useState(initial?.channel ?? 'instagram');
  const [markets, setMarkets] = useState<Market[]>(normalizeMarkets(initial?.markets));
  const [imagePrompt, setImagePrompt] = useState(initial?.imagePrompt ?? '');
  const [substantiation, setSubstantiation] = useState(initial?.substantiation ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  function toggleMarket(market: Market) {
    setMarkets((prev) =>
      prev.includes(market) ? prev.filter((m) => m !== market) : [...prev, market],
    );
  }

  function loadSample() {
    setCopy(SAMPLE.copy);
    setClaim(SAMPLE.claim);
    setChannel(SAMPLE.channel);
    setMarkets([...SAMPLE.markets] as Market[]);
    setImagePrompt(SAMPLE.imagePrompt ?? '');
    setSubstantiation(SAMPLE.substantiation ?? '');
    setError(null);
    setSaveMessage(null);
  }

  function currentValues(): ReviewFormValues {
    return {
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
    if (!copy.trim() || !claim.trim()) {
      setError('Copy and claim are required.');
      return;
    }
    if (markets.length === 0) {
      setError('Select at least one market.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body: CreateReviewRequest = {
        copy: copy.trim(),
        claim: claim.trim(),
        channel: channel.trim() || 'instagram',
        markets,
      };
      if (imagePrompt.trim()) body.imagePrompt = imagePrompt.trim();
      if (substantiation.trim()) body.substantiation = substantiation.trim();
      await onSubmit(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit review.');
      setSubmitting(false);
    }
  }

  async function handleSaveToLibrary() {
    if (!onSaveToLibrary) return;
    if (!copy.trim() || !claim.trim()) {
      setSaveMessage(null);
      setError('Copy and claim are required to save to the library.');
      return;
    }
    setSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      await onSaveToLibrary(currentValues());
      setSaveMessage('Saved to library.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save to library.');
    } finally {
      setSaving(false);
    }
  }

  const labelClass = 'block text-sm font-medium text-slate-700';
  const inputClass =
    'mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm text-slate-800 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400';

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">New review</h1>
        <button
          type="button"
          onClick={loadSample}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm transition hover:bg-slate-50"
        >
          Load sample
        </button>
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
            {MARKET_OPTIONS.map((market) => (
              <label
                key={market}
                className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm"
              >
                <input
                  type="checkbox"
                  checked={markets.includes(market)}
                  onChange={() => toggleMarket(market)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
                />
                {market}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="imagePrompt">
          Image prompt <span className="font-normal text-slate-400">(optional)</span>
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
          Substantiation <span className="font-normal text-slate-400">(optional)</span>
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

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {saveMessage ? <p className="text-sm text-emerald-600">{saveMessage}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Submitting.' : 'Submit for review'}
        </button>
        {onSaveToLibrary ? (
          <button
            type="button"
            onClick={handleSaveToLibrary}
            disabled={saving}
            className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving.' : 'Save to library'}
          </button>
        ) : null}
      </div>
    </form>
  );
}
