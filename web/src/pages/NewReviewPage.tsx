import { useNavigate } from 'react-router-dom';
import { createReview } from '../api';
import { ReviewForm } from '../components/ReviewForm';
import type { CreateReviewRequest } from '../types';

export function NewReviewPage() {
  const navigate = useNavigate();

  async function handleSubmit(body: CreateReviewRequest) {
    const { id } = await createReview(body);
    navigate(`/reviews/${id}`);
  }

  return (
    <div className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <ReviewForm onSubmit={handleSubmit} />
    </div>
  );
}
