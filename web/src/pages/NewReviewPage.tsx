import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useLocation } from 'react-router-dom';
import { createAsset } from '../api';
import { ReviewForm } from '../components/ReviewForm';
import type { CampaignFormValues } from '../components/ReviewForm';
import type { ContentAsset } from '../types';

// Assets are passed from the Library page through router state under this key.
interface NewReviewLocationState {
  prefill?: Partial<CampaignFormValues>;
}

function assetToFormValues(asset: ContentAsset): Partial<CampaignFormValues> {
  return {
    name: asset.name ?? '',
    copy: asset.copy,
    claim: asset.claim,
    channel: asset.channel,
    markets: asset.markets,
    imagePrompt: asset.imagePrompt ?? '',
    substantiation: asset.substantiation ?? '',
  };
}

export function NewReviewPage() {
  const location = useLocation();
  const state = location.state as NewReviewLocationState | null;

  const initial = useMemo<Partial<CampaignFormValues> | undefined>(
    () => state?.prefill,
    [state],
  );

  async function handleSave(values: CampaignFormValues): Promise<ContentAsset> {
    const asset = {
      name: values.name,
      channel: values.channel,
      markets: values.markets,
      copy: values.copy,
      claim: values.claim,
      ...(values.imagePrompt ? { imagePrompt: values.imagePrompt } : {}),
      ...(values.substantiation ? { substantiation: values.substantiation } : {}),
    };
    const res = await createAsset(asset);
    return res.asset;
  }

  return (
    <div className="space-y-6">
      <header className="rise max-w-2xl" style={{ '--d': '0ms' } as CSSProperties}>
        <p className="eyebrow mb-3">Compose</p>
        <h1 className="font-display text-4xl leading-[1.05] text-fg sm:text-5xl">
          Hand the band <span className="text-gradient italic">a campaign</span> to review.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Back-office for the band.ai review agents. Compose campaigns and rules here, then run the
          coordinated review in band.ai.
        </p>
      </header>

      <div
        className="rise surface mx-auto w-full max-w-2xl rounded-2xl p-6 sm:p-7"
        style={{ '--d': '90ms' } as CSSProperties}
      >
        <ReviewForm onSave={handleSave} initial={initial} />
      </div>
    </div>
  );
}

export { assetToFormValues };
