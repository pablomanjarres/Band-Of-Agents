import type {
  AdvertisementResponse,
  ArtifactResponse,
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
  Spending,
  VideoUploadResponse,
  Run,
  RunEvent,
  RunSummary,
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

// Cloud Run rejects any single request body over 32 MiB, so a video above this
// threshold is uploaded in sub-cap chunks and reassembled server-side. Smaller
// files keep the original single multipart POST.
const VIDEO_CHUNK_THRESHOLD = 20 * 1024 * 1024;
const VIDEO_CHUNK_SIZE = 16 * 1024 * 1024;

export interface UploadVideoOptions {
  campaignId?: string;
  advertisementId?: string;
  materialId?: string;
  /** Progress as a 0..1 fraction of bytes uploaded (the chunked path reports per chunk). */
  onProgress?: (fraction: number) => void;
}

// Upload a video file. The server hosts it under data/videos/ and, with
// campaignId + advertisementId + materialId, attaches the url to that material so
// the next review perceives it (frames + vision + STT over SSE). Large files are
// chunked (see VIDEO_CHUNK_THRESHOLD) so they clear Cloud Run's request-size cap.
export async function uploadVideo(file: File, opts?: UploadVideoOptions): Promise<VideoUploadResponse> {
  if (file.size <= VIDEO_CHUNK_THRESHOLD) {
    const form = new FormData();
    form.append('video', file);
    if (opts?.campaignId) form.append('campaignId', opts.campaignId);
    if (opts?.advertisementId) form.append('advertisementId', opts.advertisementId);
    if (opts?.materialId) form.append('materialId', opts.materialId);
    const res = await fetch('/api/videos', { method: 'POST', body: form });
    const out = await asJson<VideoUploadResponse>(res);
    opts?.onProgress?.(1);
    return out;
  }

  // Chunked path: slice the file, POST each piece, then finalize (assemble +
  // attach + transcribe) in one small JSON request.
  const uploadId = crypto.randomUUID();
  const total = Math.ceil(file.size / VIDEO_CHUNK_SIZE);
  for (let i = 0; i < total; i++) {
    const chunk = file.slice(i * VIDEO_CHUNK_SIZE, (i + 1) * VIDEO_CHUNK_SIZE);
    const res = await fetch(`/api/videos/chunk?uploadId=${uploadId}&index=${i}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: chunk,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Chunk ${i + 1}/${total} failed (${res.status}): ${body || res.statusText}`);
    }
    opts?.onProgress?.((i + 1) / total);
  }
  const res = await fetch('/api/videos/finalize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      uploadId,
      fileName: file.name,
      ...(opts?.campaignId ? { campaignId: opts.campaignId } : {}),
      ...(opts?.advertisementId ? { advertisementId: opts.advertisementId } : {}),
      ...(opts?.materialId ? { materialId: opts.materialId } : {}),
    }),
  });
  return asJson<VideoUploadResponse>(res);
}

// Re-run upload-time transcription for a material that ALREADY has a hosted video
// but no transcript yet. There is no separate transcribe route: the server only
// transcribes inside POST /api/videos (with a materialId), so we fetch the material's
// existing video bytes back from its same-origin url and re-post them with the
// campaign/material ids. The server re-attaches the (unchanged) videoUrl and runs the
// graceful STT pass, persisting perception.transcript. The caller then refreshes the
// campaign (GET /api/campaigns/:id) to pick it up. Returns transcribed:boolean.
export async function transcribeMaterial(opts: {
  campaignId: string;
  advertisementId?: string;
  materialId: string;
  videoUrl: string;
}): Promise<VideoUploadResponse> {
  const videoRes = await fetch(opts.videoUrl);
  if (!videoRes.ok) {
    throw new Error(`Could not read the stored video (${videoRes.status}).`);
  }
  const blob = await videoRes.blob();
  const name = opts.videoUrl.split('/').pop() || 'video.mp4';
  const file = new File([blob], name, { type: blob.type || 'video/mp4' });
  return uploadVideo(file, {
    campaignId: opts.campaignId,
    ...(opts.advertisementId ? { advertisementId: opts.advertisementId } : {}),
    materialId: opts.materialId,
  });
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
// Pass advertisementId to SCOPE the review to a single ad (still per-material
// concurrent, still reconciled per material): it simply runs fewer materials.
export async function startCampaignReview(
  campaignId: string,
  advertisementId?: string,
): Promise<CreateCampaignReviewResponse> {
  const res = await fetch('/api/reviews', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ campaignId, ...(advertisementId ? { advertisementId } : {}) }),
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

// Spending -----------------------------------------------------------------
export async function fetchSpending(): Promise<Spending> {
  const res = await fetch('/api/spending');
  return asJson<Spending>(res);
}

export interface EventSubscription {
  close: () => void;
}

// Shared EventSource wiring: replay buffered events on connect, stream new ones,
// drop malformed payloads (heartbeats) rather than crash the stream.
function subscribeSSE<T>(
  path: string,
  onEvent: (event: T) => void,
  onError?: (err: Event) => void,
): EventSubscription {
  const source = new EventSource(path);

  source.onmessage = (message: MessageEvent<string>) => {
    if (!message.data) return;
    try {
      onEvent(JSON.parse(message.data) as T);
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
  return subscribeSSE<BoardEvent>(`/api/campaign-reviews/${encodeURIComponent(id)}/events`, onEvent, onError);
}

// --- Live run mirror (Stage B): the dashboard reads runs the band.ai agents post. ---

/** Recent runs for a campaign (newest first), for the Runs list. */
export async function getCampaignRuns(campaignId: string): Promise<{ runs: RunSummary[] }> {
  const res = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/runs`);
  return asJson<{ runs: RunSummary[] }>(res);
}

/** A single run with its full lifecycle timeline. */
export async function getRun(id: string): Promise<{ run: Run }> {
  const res = await fetch(`/api/runs/${encodeURIComponent(id)}`);
  return asJson<{ run: Run }>(res);
}

/** Subscribe to a run's live lifecycle stream via EventSource. */
export function subscribeToRun(
  id: string,
  onEvent: (event: RunEvent) => void,
  onError?: (err: Event) => void,
): EventSubscription {
  return subscribeSSE<RunEvent>(`/api/runs/${encodeURIComponent(id)}/events`, onEvent, onError);
}
