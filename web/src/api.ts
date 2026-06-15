import type {
  ArtifactResponse,
  AssetListResponse,
  AssetResponse,
  BoardEvent,
  ContentAsset,
  CreateReviewRequest,
  CreateReviewResponse,
  DecisionResponse,
  PrecedentListResponse,
  ReviewListResponse,
  ReviewReplayResponse,
  Rulebook,
  RulebookListResponse,
  RulebookResponse,
  Spending,
} from './types';

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Request failed (${res.status}): ${body || res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function createReview(body: CreateReviewRequest): Promise<CreateReviewResponse> {
  const res = await fetch('/api/reviews', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return asJson<CreateReviewResponse>(res);
}

export async function submitDecision(id: string, decision: string): Promise<DecisionResponse> {
  const res = await fetch(`/api/reviews/${encodeURIComponent(id)}/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision }),
  });
  return asJson<DecisionResponse>(res);
}

export async function listReviews(): Promise<ReviewListResponse> {
  const res = await fetch('/api/reviews');
  return asJson<ReviewListResponse>(res);
}

export async function getReview(id: string): Promise<ReviewReplayResponse> {
  const res = await fetch(`/api/reviews/${encodeURIComponent(id)}`);
  return asJson<ReviewReplayResponse>(res);
}

// Rulebooks ----------------------------------------------------------------
export async function listRulebooks(): Promise<RulebookListResponse> {
  const res = await fetch('/api/rulebooks');
  return asJson<RulebookListResponse>(res);
}

export async function getRulebook(region: string): Promise<RulebookResponse> {
  const res = await fetch(`/api/rulebooks/${encodeURIComponent(region)}`);
  return asJson<RulebookResponse>(res);
}

export async function saveRulebook(
  region: string,
  rulebook: Rulebook,
): Promise<RulebookResponse> {
  const res = await fetch(`/api/rulebooks/${encodeURIComponent(region)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(rulebook),
  });
  return asJson<RulebookResponse>(res);
}

// Asset library ------------------------------------------------------------
export async function listAssets(): Promise<AssetListResponse> {
  const res = await fetch('/api/assets');
  return asJson<AssetListResponse>(res);
}

export type NewContentAsset = Omit<ContentAsset, 'id'> & { id?: string };

export async function createAsset(asset: NewContentAsset): Promise<AssetResponse> {
  const res = await fetch('/api/assets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(asset),
  });
  return asJson<AssetResponse>(res);
}

// Artifacts ----------------------------------------------------------------
export async function getArtifact(id: string): Promise<ArtifactResponse> {
  const res = await fetch(`/api/artifacts/${encodeURIComponent(id)}`);
  return asJson<ArtifactResponse>(res);
}

// Precedent log ------------------------------------------------------------
export async function listPrecedents(): Promise<PrecedentListResponse> {
  const res = await fetch('/api/precedents');
  return asJson<PrecedentListResponse>(res);
}

// Spending -----------------------------------------------------------------
export async function fetchSpending(): Promise<Spending> {
  const res = await fetch('/api/spending');
  return asJson<Spending>(res);
}

export interface EventSubscription {
  close: () => void;
}

/**
 * Subscribe to the live event stream for a review via EventSource.
 * The server replays buffered events on connect, then streams new ones.
 * Each SSE message payload is a single JSON-encoded BoardEvent.
 */
export function subscribeToEvents(
  id: string,
  onEvent: (event: BoardEvent) => void,
  onError?: (err: Event) => void,
): EventSubscription {
  const source = new EventSource(`/api/reviews/${encodeURIComponent(id)}/events`);

  source.onmessage = (message: MessageEvent<string>) => {
    if (!message.data) return;
    try {
      const parsed = JSON.parse(message.data) as BoardEvent;
      onEvent(parsed);
    } catch {
      // Ignore malformed payloads (e.g. heartbeat comments) rather than crash the stream.
    }
  };

  if (onError) {
    source.onerror = onError;
  }

  return {
    close: () => source.close(),
  };
}
