import { useMemo } from 'react';
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
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm text-slate-600">
          Back-office for the band.ai review agents. Compose campaigns and rules here; run the
          review in band.ai.
        </p>
      </div>

      <div className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <ReviewForm onSave={handleSave} initial={initial} />
      </div>
    </div>
  );
}

export { assetToFormValues };
