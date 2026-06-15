import type {
  AssetListResponse,
  AssetResponse,
  BoardEvent,
  Campaign,
  CampaignListResponse,
  CampaignResponse,
  CampaignReviewResponse,
  ContentAsset,
  CreateCampaignReviewResponse,
  CreateReviewRequest,
  CreateReviewResponse,
  DecisionResponse,
  Material,
  MaterialResponse,
  PrecedentListResponse,
  ReviewListResponse,
  ReviewReplayResponse,
  Rulebook,
  RulebookListResponse,
  RulebookResponse,
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

// Precedent log ------------------------------------------------------------
export async function listPrecedents(): Promise<PrecedentListResponse> {
  const res = await fetch('/api/precedents');
  return asJson<PrecedentListResponse>(res);
}

// Campaigns ----------------------------------------------------------------
export async function listCampaigns(): Promise<CampaignListResponse> {
  const res = await fetch('/api/campaigns');
  return asJson<CampaignListResponse>(res);
}

export async function getCampaign(id: string): Promise<CampaignResponse> {
  const res = await fetch(`/api/campaigns/${encodeURIComponent(id)}`);
  return asJson<CampaignResponse>(res);
}

export type NewCampaign = Omit<Campaign, 'id'> & { id?: string };

// Save or update a campaign (id auto-assigned by the server when absent). Used
// both to create a campaign and to persist dossier edits on the detail page.
export async function saveCampaign(campaign: NewCampaign): Promise<CampaignResponse> {
  const res = await fetch('/api/campaigns', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(campaign),
  });
  return asJson<CampaignResponse>(res);
}

export type NewMaterial = Omit<Material, 'id'> & { id?: string };

export async function addMaterial(
  campaignId: string,
  material: NewMaterial,
): Promise<MaterialResponse> {
  const res = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/materials`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(material),
  });
  return asJson<MaterialResponse>(res);
}

// Start a concurrent per-material review of a saved campaign (local board mode).
// Returns the campaign-review id whose rollup + per-material lanes stream over SSE.
export async function startCampaignReview(
  campaignId: string,
): Promise<CreateCampaignReviewResponse> {
  const res = await fetch('/api/reviews', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ campaignId }),
  });
  return asJson<CreateCampaignReviewResponse>(res);
}

export async function getCampaignReview(id: string): Promise<CampaignReviewResponse> {
  const res = await fetch(`/api/campaign-reviews/${encodeURIComponent(id)}`);
  return asJson<CampaignReviewResponse>(res);
}

export async function submitCampaignDecision(
  id: string,
  materialId: string,
  decision: string,
): Promise<DecisionResponse> {
  const res = await fetch(`/api/campaign-reviews/${encodeURIComponent(id)}/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ materialId, decision }),
  });
  return asJson<DecisionResponse>(res);
}

export interface EventSubscription {
  close: () => void;
}

// Shared EventSource wiring: replay buffered events on connect, stream new ones,
// drop malformed payloads (heartbeats) rather than crash the stream.
function subscribeSSE(
  path: string,
  onEvent: (event: BoardEvent) => void,
  onError?: (err: Event) => void,
): EventSubscription {
  const source = new EventSource(path);

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

/**
 * Subscribe to the live event stream for a single review via EventSource.
 * Each SSE message payload is a single JSON-encoded BoardEvent.
 */
export function subscribeToEvents(
  id: string,
  onEvent: (event: BoardEvent) => void,
  onError?: (err: Event) => void,
): EventSubscription {
  return subscribeSSE(`/api/reviews/${encodeURIComponent(id)}/events`, onEvent, onError);
}

/**
 * Subscribe to a campaign review's combined stream. Every event carries a
 * materialId so the consumer can lane it to the right material; the stream stays
 * open until a campaign-level terminal status (no materialId) arrives.
 */
export function subscribeToCampaignEvents(
  id: string,
  onEvent: (event: BoardEvent) => void,
  onError?: (err: Event) => void,
): EventSubscription {
  return subscribeSSE(`/api/campaign-reviews/${encodeURIComponent(id)}/events`, onEvent, onError);
}
