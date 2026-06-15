import type {
  AdvertisementResponse,
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
  ImageUploadResponse,
  Material,
  MaterialResponse,
  PrecedentListResponse,
  ReviewListResponse,
  ReviewReplayResponse,
  Rulebook,
  RulebookImportRequest,
  RulebookListResponse,
  RulebookPresetListResponse,
  RulebookResponse,
  VideoUploadResponse,
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

export async function saveRulebook(region: string, rulebook: Rulebook): Promise<RulebookResponse> {
  const res = await fetch(`/api/rulebooks/${encodeURIComponent(region)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(rulebook),
  });
  return asJson<RulebookResponse>(res);
}

// Smart import: send a raw rulebook (.md / .json / plain text) and get back a
// validated Rulebook PROPOSAL. Nothing is persisted; the caller reviews and saves
// via saveRulebook (PUT). md/text go through the AIML-default model; json validates.
export async function importRulebook(
  region: string,
  body: RulebookImportRequest,
): Promise<RulebookResponse> {
  const res = await fetch(`/api/rulebooks/${encodeURIComponent(region)}/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return asJson<RulebookResponse>(res);
}

export async function listRulebookPresets(): Promise<RulebookPresetListResponse> {
  const res = await fetch('/api/rulebooks/presets');
  return asJson<RulebookPresetListResponse>(res);
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

// Save or update a campaign (id auto-assigned when absent). Used to create a
// campaign and to persist dossier edits on the detail page.
export async function saveCampaign(campaign: NewCampaign): Promise<CampaignResponse> {
  const res = await fetch('/api/campaigns', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(campaign),
  });
  return asJson<CampaignResponse>(res);
}

export interface NewAdvertisement {
  name: string;
  markets?: string[];
}

// Add an advertisement to a campaign (works at any time, including after a review).
export async function createAdvertisement(
  campaignId: string,
  ad: NewAdvertisement,
): Promise<AdvertisementResponse> {
  const res = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/advertisements`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ad),
  });
  return asJson<AdvertisementResponse>(res);
}

export type NewMaterial = Omit<Material, 'id'> & { id?: string };

// Add a material to a specific advertisement (works at any time).
export async function addMaterial(
  campaignId: string,
  advertisementId: string,
  material: NewMaterial,
): Promise<MaterialResponse> {
  const res = await fetch(
    `/api/campaigns/${encodeURIComponent(campaignId)}/advertisements/${encodeURIComponent(advertisementId)}/materials`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(material),
    },
  );
  return asJson<MaterialResponse>(res);
}

// Upload a video file (multipart). The server hosts it under data/videos/ and,
// with campaignId + advertisementId + materialId, attaches the url to that
// material so the next review perceives it (frames + vision + STT over SSE).
export async function uploadVideo(
  file: File,
  opts?: { campaignId?: string; advertisementId?: string; materialId?: string },
): Promise<VideoUploadResponse> {
  const form = new FormData();
  form.append('video', file);
  if (opts?.campaignId) form.append('campaignId', opts.campaignId);
  if (opts?.advertisementId) form.append('advertisementId', opts.advertisementId);
  if (opts?.materialId) form.append('materialId', opts.materialId);
  const res = await fetch('/api/videos', { method: 'POST', body: form });
  return asJson<VideoUploadResponse>(res);
}

// Upload an image file (multipart). The server hosts it under data/images/ and
// returns the served url, used as a material's imageUrl / perception frame.
export async function uploadImage(file: File): Promise<ImageUploadResponse> {
  const form = new FormData();
  form.append('image', file);
  const res = await fetch('/api/images', { method: 'POST', body: form });
  return asJson<ImageUploadResponse>(res);
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
      // Ignore malformed payloads (e.g. heartbeat comments) rather than crash.
    }
  };

  if (onError) source.onerror = onError;

  return { close: () => source.close() };
}

/** Subscribe to a single review's live event stream via EventSource. */
export function subscribeToEvents(
  id: string,
  onEvent: (event: BoardEvent) => void,
  onError?: (err: Event) => void,
): EventSubscription {
  return subscribeSSE(`/api/reviews/${encodeURIComponent(id)}/events`, onEvent, onError);
}

/** Subscribe to a campaign review's combined stream (every event carries ids). */
export function subscribeToCampaignEvents(
  id: string,
  onEvent: (event: BoardEvent) => void,
  onError?: (err: Event) => void,
): EventSubscription {
  return subscribeSSE(`/api/campaign-reviews/${encodeURIComponent(id)}/events`, onEvent, onError);
}
