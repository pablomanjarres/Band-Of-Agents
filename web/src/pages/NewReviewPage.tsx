import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { createAsset, createReview } from '../api';
import { ReviewForm } from '../components/ReviewForm';
import type { ReviewFormValues } from '../components/ReviewForm';
import type { ContentAsset, CreateReviewRequest } from '../types';

// Assets are passed from the Library page through router state under this key.
interface NewReviewLocationState {
  prefill?: Partial<ReviewFormValues>;
}

function assetToFormValues(asset: ContentAsset): Partial<ReviewFormValues> {
  return {
    copy: asset.copy,
    claim: asset.claim,
    channel: asset.channel,
    markets: asset.markets,
    imagePrompt: asset.imagePrompt ?? '',
    substantiation: asset.substantiation ?? '',
  };
}

export function NewReviewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as NewReviewLocationState | null;

  const initial = useMemo<Partial<ReviewFormValues> | undefined>(
    () => state?.prefill,
    [state],
  );

  async function handleSubmit(body: CreateReviewRequest) {
    const { id } = await createReview(body);
    navigate(`/reviews/${id}`);
  }

  async function handleSaveToLibrary(values: ReviewFormValues) {
    const asset = {
      channel: values.channel,
      markets: values.markets,
      copy: values.copy,
      claim: values.claim,
      ...(values.imagePrompt ? { imagePrompt: values.imagePrompt } : {}),
      ...(values.substantiation ? { substantiation: values.substantiation } : {}),
    };
    await createAsset(asset);
  }

  return (
    <div className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <ReviewForm
        onSubmit={handleSubmit}
        initial={initial}
        onSaveToLibrary={handleSaveToLibrary}
      />
    </div>
  );
}

export { assetToFormValues };
