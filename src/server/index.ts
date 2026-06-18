// HTTP + SSE backend for the campaign portal. Reuses the domain, agents, and
// model routing in src/. A POST submits a campaign; the console subscribes over
// SSE and watches the review stream in live.
//
//   pnpm serve                       (BOARD_MODE=band, the product: a real band.ai room)
//   BOARD_MODE=local pnpm serve      (in-process transport; dev/offline fallback)
//
// In band mode the Intake agent creates a real band.ai room, adds the reviewer
// agents, and posts the campaign; the agents collaborate in band.ai and the
// server only observes. A small file-backed Store persists reviews, the
// precedent log, the asset library, and per-region rulebook overrides.

import 'dotenv/config';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { loadBrandDna, loadRulebook } from '../domain/load';
import { Advertisement as AdvertisementSchema, Campaign as CampaignSchema, ContentAsset as ContentAssetSchema, Material as MaterialSchema, MaterialReview as MaterialReviewSchema, Rulebook as RulebookSchema } from '../domain/types';
import type { Advertisement, Campaign, ContentAsset, Material, Rulebook } from '../domain/types';
import { CreateRunSchema, RunEventInputSchema, toRunSummary } from '../domain/runs';
import type { Run, RunEvent, RunStatus } from '../domain/runs';
import { NewArtifact as NewArtifactSchema } from '../domain/artifact';
import { BoardSession, realBoardModels, realPerceptionModels, type BoardModels } from '../board/session';
import { transcribeVideoMaterial } from '../perception/transcribe';
import { PodBoardSession } from '../board/pod-session';
import { realPodBoardModels } from '../board/pod-board';
import { type ModelClient, type SttClient } from '../models/client';
import { demoCampaignModels, demoPerception } from '../run/demo-fixtures';
import { CampaignSession, type CampaignRollup } from '../board/campaign';
import { CampaignBandSession } from '../board/campaign-band';
import { createReviewRoom, postUserMessage, listRoomMessages, selectNewMessages, relayConfigured } from './relay';
import { BandBoard } from '../board/band-session';
import { modelFor } from '../models/route';
import { importRulebook, type ImportFormat } from '../domain/rulebook-import';
import { loadPresets } from '../domain/presets';
import type { BoardEvent, BoardStatus } from '../board/events';
import { Store } from '../store/store';
import { makePublishArtifact } from '../store/artifacts';
import { makeGcsMirror, restoreFromGcs } from '../store/gcs-backup';
import { spend, readSpendSnapshot, SPEND_FILE } from '../models/spend';

const ASSETS = new URL('../../assets/', import.meta.url).pathname;
const PRESETS_DIR = new URL('../../assets/presets/', import.meta.url).pathname;
const WEB_DIST = new URL('../../web/dist/', import.meta.url).pathname;
const DATA_DIR = new URL('../../data/', import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 8787);
// The origin baked into artifact links agents paste into Band, so a human can
// click them from the Band UI. Prefer an explicit PUBLIC_BASE_URL; on Vercel
// fall back to the deployment hostname (VERCEL_PROJECT_PRODUCTION_URL or the
// per-deploy VERCEL_URL, both without a scheme); otherwise the local origin.
function resolvePublicBaseUrl(): string {
  const explicit = process.env.PUBLIC_BASE_URL;
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  const base = explicit ?? (vercelHost ? `https://${vercelHost}` : `http://localhost:${PORT}`);
  return base.replace(/\/+$/, '');
}
const PUBLIC_BASE_URL = resolvePublicBaseUrl();
const BOARD_MODE = process.env.BOARD_MODE === 'local' ? 'local' : 'band';
// Orchestration topology: 'pods' runs the blackboard pods + decision spine
// (PodBoardSession); 'classic' runs the original coordinator/reconcile board.
const BOARD_TOPOLOGY = process.env.BOARD_TOPOLOGY === 'pods' ? 'pods' : 'classic';
const REGIONS = ['us', 'eu', 'latam'] as const;
type RegionKey = (typeof REGIONS)[number];

interface ReviewRecord {
  id: string;
  createdAt: number;
  asset: ContentAsset;
  events: BoardEvent[];
  status: BoardStatus;
  conflict: boolean;
  subscribers: Set<(event: BoardEvent) => void>;
  submitDecision: (text: string) => Promise<void>;
}

// A campaign review is ONE id under which every material's events stream (each
// event carries materialId, so the UI lanes them). The rollup is recomputed as
// verdicts arrive; it is observational and gates nothing (the one rule).
interface CampaignReviewRecord {
  id: string;
  createdAt: number;
  campaign: Campaign;
  events: BoardEvent[];
  status: BoardStatus;
  conflict: boolean;
  rollup: CampaignRollup | null;
  subscribers: Set<(event: BoardEvent) => void>;
  submitDecision: (materialId: string, text: string) => Promise<void>;
}

const reviews = new Map<string, ReviewRecord>();
const campaignReviews = new Map<string, CampaignReviewRecord>();

// Live band.ai run mirror (Stage B): the agents POST a run when a review starts and
// append one lifecycle event per beat; the dashboard subscribes (SSE) and lists them.
// In-memory like campaignReviews: the DURABLE record of "this was reviewed" is the
// material.review verdict (GCS-backed); a run is the ephemeral live timeline.
interface RunRecord extends Run {
  subscribers: Set<(event: RunEvent) => void>;
}
const runs = new Map<string, RunRecord>();
const MAX_RUNS = 60; // keep memory bounded; oldest runs drop off

function appendRunEvent(
  record: RunRecord,
  input: { stage: RunEvent['stage']; message: string; agent?: string; materialId?: string; artifact?: RunEvent['artifact']; status?: RunStatus },
): RunEvent {
  const event: RunEvent = {
    seq: record.events.length,
    at: Date.now(),
    stage: input.stage,
    message: input.message,
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.materialId ? { materialId: input.materialId } : {}),
    ...(input.artifact ? { artifact: input.artifact } : {}),
  };
  record.events.push(event);
  record.updatedAt = event.at;
  if (input.status) record.status = input.status;
  for (const sub of record.subscribers) sub(event);
  return event;
}
// The long-lived BandBoard (BOARD_MODE=band): connected once in main(), it hosts
// the agents that do the reviewing in band.ai. runCampaignReview drives it via a
// CampaignBandSession (Intake posts each material into a band.ai room; the board
// observes). Stays undefined in local mode / on import (no agents connected).
let bandBoard: BandBoard | undefined;
// Durable state on Cloud Run: when GCS_BUCKET is set, mirror every write to a
// private bucket and restore from it on boot (see main()). Local dev leaves it
// unset and uses the plain file store.
const GCS_BUCKET = process.env.GCS_BUCKET;
const GCS_PREFIX = process.env.GCS_PREFIX ?? 'state';
const gcsMirror = GCS_BUCKET ? makeGcsMirror(GCS_BUCKET, DATA_DIR, GCS_PREFIX) : undefined;
const store = new Store(DATA_DIR, gcsMirror);
// Agents publish artifacts (images, reports) and paste the returned viewer URL
// into the room, since Band shows only plain text.
const publishArtifact = makePublishArtifact(store, PUBLIC_BASE_URL);

// Key-free local demo fallback. In local mode with no AIML key (and not dev mode),
// the real model clients cannot be constructed (modelFor throws). Rather than fail
// the portal, we fall back to deterministic STUB models so the campaign still
// reviews and the perception panel still animates over the seeded frames, exactly
// like `npm run local`. The product paths (an AIML key set, MODEL_MODE=dev, or
// BOARD_MODE=band) are untouched: real models are used whenever they can be built.
const KEY_FREE_LOCAL = BOARD_MODE === 'local' && process.env.MODEL_MODE !== 'dev' && !process.env.AIML_API_KEY;

// Rich key-free demo: the shared seeded-campaign scenario (real US/EU conflict),
// so the portal runs a full review and the perception panel animates with no API
// key. Same fixtures the console runner uses, keyed by material id.
function stubBoardModels(): BoardModels {
  return demoCampaignModels();
}

function stubPerceptionModels(): { vision: ModelClient; stt: SttClient } {
  return demoPerception();
}

/** Reviewer models: real when constructible, else the key-free demo stubs. */
function boardModelsOrStub(): BoardModels {
  if (KEY_FREE_LOCAL) return stubBoardModels();
  try {
    return realBoardModels();
  } catch {
    return stubBoardModels();
  }
}

/** Perception clients: real when available, else demo stubs (so the UI animates). */
function perceptionOrStub(): { vision?: ModelClient; stt?: SttClient } {
  if (KEY_FREE_LOCAL) {
    // Even in the key-free demo, prefer REAL perception when a provider is reachable
    // on GCP auth alone (a Vertex service account on Cloud Run, or a Gemini API key):
    // uploaded videos then get a real transcript instead of the demo stub, while the
    // reviewers stay stubbed. Fall back to the stub only when nothing real is reachable.
    const real = realPerceptionModels();
    if (real.vision || real.stt) return real;
    return stubPerceptionModels();
  }
  return realPerceptionModels();
}

// Multimodal perception config (vision + STT) plus the video-path resolver. Absent
// clients => that modality is skipped (graceful). The store resolves a hosted
// /api/videos/<name> url back to its local file so ffmpeg/STT can read the bytes.
const perceptionConfig = {
  ...perceptionOrStub(),
  resolveVideoPath: (videoUrl: string) => store.videoPath(videoUrl),
};

// Feed recent human-decision precedents back into the reviewers' shared context.
const recentPrecedents = (): string[] =>
  store.listPrecedents().slice(-6).map((p) => `${p.regions.join('/')}: ${p.decision}`);

const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
const defaultRulebooks: Record<RegionKey, Rulebook> = {
  us: loadRulebook(`${ASSETS}rulebook.us.json`),
  eu: loadRulebook(`${ASSETS}rulebook.eu.json`),
  latam: loadRulebook(`${ASSETS}rulebook.latam.json`),
};

function currentRulebooks(): Record<RegionKey, Rulebook> {
  return {
    us: store.getRulebookOverride('US') ?? defaultRulebooks.us,
    eu: store.getRulebookOverride('EU') ?? defaultRulebooks.eu,
    latam: store.getRulebookOverride('LATAM') ?? defaultRulebooks.latam,
  };
}

// The model used to parse a freeform (.md/text) rulebook into structured rules.
// AIML is the default route (MODEL_MODE); we reuse the EU reviewer's slot because
// it is a strong, strict structured-output model. No new model ids are added.
function importModel() {
  return modelFor('eu');
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Resolve a human's free-text reference ("review campaign Immune+ Q3") to a saved campaign.
function findCampaign(query: string): ContentAsset | undefined {
  const q = normalizeName(query);
  if (!q) return undefined;
  return store.listAssets().find((a) => {
    const name = a.name ? normalizeName(a.name) : '';
    return name.length > 0 && q.includes(name);
  });
}

// A review just started in a band.ai room: create its record and return the event sink.
function registerDiscoveredReview(roomId: string): (event: BoardEvent) => void {
  const record: ReviewRecord = {
    id: roomId,
    createdAt: Date.now(),
    asset: { id: `room-${roomId.slice(0, 8)}`, channel: '', markets: [], copy: '', claim: '' },
    events: [],
    status: 'running',
    conflict: false,
    subscribers: new Set(),
    submitDecision: async () => {},
  };
  reviews.set(roomId, record);
  return makeOnEvent(record);
}

// band mode: connect the agents (you add them in app.band.ai) and OBSERVE. We never
// create rooms. Built lazily inside main() (only when actually serving in band
// mode) so importing this module (e.g. in tests, or in local mode) never
// constructs the real board models, which would require an AIML key.
function buildBandBoard(): BandBoard | undefined {
  if (BOARD_MODE !== 'band') return undefined;
  return new BandBoard({
    brand,
    rulebooks: currentRulebooks(),
    models: realBoardModels(),
    ...(process.env.HUMAN_HANDLE ? { humanHandle: process.env.HUMAN_HANDLE } : {}),
    hostImage: (u) => store.hostImage(u) ?? u,
    publishArtifact,
    getPrecedents: recentPrecedents,
    getRulebook: (region) => store.getRulebookOverride(region) ?? defaultRulebooks[region.toLowerCase() as RegionKey] ?? defaultRulebooks.us,
    lookupCampaign: findCampaign,
    logPrecedent: (p) => store.appendPrecedent(p),
    onReviewDiscovered: registerDiscoveredReview,
  });
}

const CreateReview = z.object({
  copy: z.string().min(1),
  claim: z.string().min(1),
  channel: z.string().min(1).default('instagram'),
  markets: z.array(z.string()).min(1),
  imagePrompt: z.string().optional(),
  substantiation: z.string().optional(),
});

// JSON body for a dossier source (the non-multipart path). content is required;
// name/kind are optional (kind defaults to text).
const DossierSourceBody = z.object({
  name: z.string().optional(),
  kind: z.enum(['md', 'json', 'text']).optional(),
  content: z.string().min(1),
});

function imageContentType(name: string): string {
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

function videoContentType(name: string): string {
  if (name.endsWith('.mp4') || name.endsWith('.m4v')) return 'video/mp4';
  if (name.endsWith('.webm')) return 'video/webm';
  if (name.endsWith('.mov')) return 'video/quicktime';
  return 'application/octet-stream';
}

function extOf(filename: string, fallback = 'mp4'): string {
  const m = /\.([a-z0-9]+)$/i.exec(filename);
  return m && m[1] ? m[1].toLowerCase() : fallback;
}

// --- Advertisement-aware campaign helpers --------------------------------
// A material lives inside an advertisement now, so mutations walk the ad tier.

/** Total material count across every advertisement. */
function materialCount(camp: Campaign): number {
  return camp.advertisements.reduce((n, ad) => n + ad.materials.length, 0);
}

/** All materials across every advertisement (flattened). */
function allMaterials(camp: Campaign): Material[] {
  return camp.advertisements.flatMap((ad) => ad.materials);
}

/** Apply a patch to the material with this id, wherever it lives, returning a new campaign. */
function patchMaterial(camp: Campaign, materialId: string, patch: (m: Material) => Material): Campaign {
  return {
    ...camp,
    advertisements: camp.advertisements.map((ad) => ({
      ...ad,
      materials: ad.materials.map((m) => (m.id === materialId ? patch(m) : m)),
    })),
  };
}

/**
 * Add (or replace by id) a material under a target advertisement. When
 * advertisementId is omitted, the first advertisement is used; when the campaign
 * has no advertisements yet, a single "Default" advertisement is created. The
 * material is removed from any OTHER advertisement first, so an id stays unique.
 */
function addMaterialToCampaign(camp: Campaign, material: Material, advertisementId?: string): Campaign {
  let advertisements = camp.advertisements.map((ad) => ({
    ...ad,
    materials: ad.materials.filter((m) => m.id !== material.id),
  }));
  if (advertisements.length === 0) advertisements = [{ id: 'default', name: 'Default', materials: [] }];
  const targetId = advertisementId && advertisements.some((ad) => ad.id === advertisementId)
    ? advertisementId
    : advertisements[0]!.id;
  advertisements = advertisements.map((ad) =>
    ad.id === targetId ? { ...ad, materials: [...ad.materials, material] } : ad,
  );
  return { ...camp, advertisements };
}

/**
 * Run the upload-time transcription step on one material and PERSIST the resulting
 * perception (transcript + sampled keyframes) back into the stored campaign, so
 * GET /api/campaigns/:id returns it and the material detail can show the
 * transcript. Reuses the same perception config a review uses (so the STT client
 * and the videoUrl->local-file resolver match), and re-reads the campaign before
 * writing so a concurrent edit is not clobbered. Fully graceful: with no STT
 * provider, no ffmpeg, or no audio track the transcript is just left empty and the
 * campaign is still (re)saved with the videoUrl intact. Returns true when a
 * non-empty transcript was produced. Never throws.
 */
async function attachTranscript(campaignId: string, materialId: string, campWithVideo: Campaign): Promise<boolean> {
  try {
    const material = allMaterials(campWithVideo).find((m) => m.id === materialId);
    if (!material) return false;
    const perception = await transcribeVideoMaterial(material, {
      ...(perceptionConfig.stt ? { sttModel: perceptionConfig.stt } : {}),
      resolveVideoPath: perceptionConfig.resolveVideoPath,
      hostImage: (u) => store.hostImage(u) ?? u,
    });
    // Re-read so we patch the latest persisted campaign, then save the perception.
    const latest = store.getCampaign(campaignId) ?? campWithVideo;
    store.saveCampaign(patchMaterial(latest, materialId, (m) => ({ ...m, perception })));
    return Boolean(perception.transcript && perception.transcript.trim().length > 0);
  } catch (err) {
    console.warn('[videos] transcription failed (continuing):', (err as Error)?.message ?? String(err));
    return false;
  }
}

function makeOnEvent(record: ReviewRecord): (event: BoardEvent) => void {
  return (event) => {
    let e = event;
    // Host generated images out of the event stream so stored/streamed payloads stay small.
    if (e.type === 'revised' && e.imageUrl) {
      const hosted = store.hostImage(e.imageUrl);
      if (hosted) e = { ...e, imageUrl: hosted };
    }
    e = { ...e, seq: record.events.length } as BoardEvent;
    record.events.push(e);
    if (e.type === 'intake') record.asset = e.asset;
    if (e.type === 'verdict' && e.conflict) record.conflict = true;
    if (e.type === 'status') {
      record.status = e.status;
      if (e.status !== 'running') {
        store.saveReview({ id: record.id, createdAt: record.createdAt, asset: record.asset, events: record.events, status: record.status, conflict: record.conflict });
      }
    }
    for (const sub of record.subscribers) sub(e);
  };
}

// Campaign event sink: every per-material event is image-hosted, seq-stamped, and
// fanned out under the single campaign-review id. Per-material status events keep
// their materialId so the UI lanes them and the campaign SSE does NOT close on
// them; the campaign-level terminal is a separate status event with no materialId.
function makeCampaignOnEvent(record: CampaignReviewRecord): (event: BoardEvent) => void {
  return (event) => {
    let e = event;
    if (e.type === 'revised' && e.imageUrl) {
      const hosted = store.hostImage(e.imageUrl);
      if (hosted) e = { ...e, imageUrl: hosted };
    }
    e = { ...e, seq: record.events.length } as BoardEvent;
    record.events.push(e);
    if (e.type === 'verdict' && e.conflict) record.conflict = true;
    for (const sub of record.subscribers) sub(e);
  };
}

// Run a campaign as concurrent per-material reviews. Returns the record id; the
// caller streams events over SSE. The campaign status stays 'running' until every
// material is terminal (CampaignSession.run resolves), then becomes 'complete' or
// 'awaiting-decision' (any material escalated) and a campaign-level status event
// is emitted (no materialId) so the SSE consumer knows the whole campaign rested.
function runCampaignReview(campaign: Campaign, advertisementId?: string): string {
  const id = randomUUID();
  const record: CampaignReviewRecord = {
    id,
    createdAt: Date.now(),
    campaign,
    events: [],
    status: 'running',
    conflict: false,
    rollup: null,
    subscribers: new Set(),
    submitDecision: async () => {},
  };
  const onEvent = makeCampaignOnEvent(record);
  campaignReviews.set(id, record);

  // Build the session and run inside the async flow so a missing key / provider
  // failure degrades THIS review to a status:error event (mirroring the single-
  // asset path that returns {id} then fails async), never a 500 or a dead portal.
  void (async () => {
    try {
      // BOARD_MODE=band: the review runs THROUGH band.ai. The Intake posts each
      // material into a band.ai room and the connected BandBoard agents do the
      // reviewing; we OBSERVE the per-material events (tagged campaignId/ad/
      // material). BOARD_MODE=local: the in-process CampaignSession runs it. Both
      // are per material, concurrent, with NO campaign/ad-wide gate; both feed the
      // same record + rollup, so the SSE/rollup/decision endpoints are unchanged.
      let rollup: CampaignRollup;
      if (BOARD_MODE === 'band') {
        if (!bandBoard) throw new Error('band.ai board not connected');
        const session = new CampaignBandSession({
          board: bandBoard,
          roomId: `campaign-${id}`,
          campaign,
          ...(advertisementId ? { advertisementId } : {}),
          onEvent: (e) => {
            onEvent(e);
            record.rollup = session.rollup();
          },
        });
        record.submitDecision = (materialId, text) => session.submitDecision(materialId, text);
        // Note: the per-material room sinks are intentionally NOT released when
        // run() resolves: an escalated material rests at awaiting-decision and its
        // room must stay observed so a later human ruling (the decision endpoint)
        // routes back into this campaign's lanes. Each review uses a unique run
        // roomId, so rooms never collide across reviews. session.dispose() exists
        // for an explicit teardown if a caller ever needs it.
        rollup = await session.run();
      } else {
        const session = new CampaignSession({
          roomId: `campaign-${id}`,
          campaign,
          // Optional scope: when present, only this advertisement's materials are
          // reviewed (still concurrent, still per material); the rollup then covers
          // just that ad. Absent => the unchanged whole-campaign review.
          ...(advertisementId ? { advertisementId } : {}),
          brand,
          rulebooks: currentRulebooks(),
          models: boardModelsOrStub(),
          onEvent: (e) => {
            onEvent(e);
            record.rollup = session.rollup();
          },
          onPrecedent: (precedent) => store.appendPrecedent(precedent),
          hostImage: (u) => store.hostImage(u) ?? u,
          getPrecedents: recentPrecedents,
          perception: perceptionConfig,
        });
        record.submitDecision = (materialId, text) => session.submitDecision(materialId, text);
        rollup = await session.run();
      }
      record.rollup = rollup;
      const escalated = rollup.worstCaseByRegion.some((r) => r.decision === 'escalate');
      record.status = escalated ? 'awaiting-decision' : 'complete';
      onEvent({ type: 'status', seq: 0, fromName: 'system', status: record.status });
    } catch (err: unknown) {
      record.status = 'error';
      onEvent({ type: 'log', seq: 0, fromName: 'system', messageType: 'error', text: `Campaign review failed: ${(err as Error)?.message ?? String(err)}` });
      onEvent({ type: 'status', seq: 0, fromName: 'system', status: 'error' });
    }
  })();
  return id;
}

// A model/provider failure should degrade a single review, never take down the
// portal (e.g. an expired Vertex token surfacing as an async rejection).
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandled rejection (continuing):', (reason as Error)?.message ?? String(reason));
});

const app = new Hono();
app.use('/api/*', cors());

app.post('/api/reviews', async (c) => {
  const body: unknown = await c.req.json().catch(() => ({}));

  // Campaign mode: a saved campaignId or an inline campaign runs every material
  // concurrently. An optional advertisementId SCOPES the review to one ad's
  // materials (still concurrent, still per material): fewer materials run, the
  // rollup covers just that ad, no new gate. This path runs in BOTH modes: in
  // band mode runCampaignReview drives the band.ai flow (Intake posts each material
  // into a room, the connected agents review, we observe); in local mode it runs
  // the in-process CampaignSession. The single-asset payload below stays band.ai-
  // only in band mode (no regression to the local single-asset path).
  const b = (body ?? {}) as { campaignId?: unknown; campaign?: unknown; advertisementId?: unknown; materialId?: unknown };
  if (typeof b.campaignId === 'string' || (b.campaign && typeof b.campaign === 'object')) {
    let campaign: Campaign | undefined;
    if (typeof b.campaignId === 'string') {
      campaign = store.getCampaign(b.campaignId);
      if (!campaign) return c.json({ error: `campaign ${b.campaignId} not found` }, 404);
    } else {
      const parsedCampaign = CampaignSchema.safeParse(b.campaign);
      if (!parsedCampaign.success) return c.json({ error: parsedCampaign.error.flatten() }, 400);
      campaign = parsedCampaign.data;
    }
    // Optional scope to a single advertisement. When present it must exist in the
    // campaign (404 otherwise, mirroring the add-material path); the review then
    // runs only that ad's materials.
    const advertisementId = typeof b.advertisementId === 'string' ? b.advertisementId : undefined;
    if (advertisementId !== undefined && !campaign.advertisements.some((ad) => ad.id === advertisementId)) {
      return c.json({ error: `advertisement ${advertisementId} not found` }, 404);
    }
    // Optional scope to a SINGLE material: prune the campaign to just that material's
    // advertisement carrying only that material, so the review opens exactly ONE
    // band.ai room (one click = one chat) instead of one room per material.
    const materialId = typeof b.materialId === 'string' ? b.materialId : undefined;
    let reviewCampaign = campaign;
    let reviewAdId = advertisementId;
    if (materialId !== undefined) {
      const candidateAds = advertisementId !== undefined
        ? campaign.advertisements.filter((ad) => ad.id === advertisementId)
        : campaign.advertisements;
      const ad = candidateAds.find((a) => a.materials.some((m) => m.id === materialId));
      if (!ad) return c.json({ error: `material ${materialId} not found` }, 404);
      reviewCampaign = { ...campaign, advertisements: [{ ...ad, materials: ad.materials.filter((m) => m.id === materialId) }] };
      reviewAdId = ad.id;
    }
    const scopedMaterials = (reviewAdId !== undefined
      ? reviewCampaign.advertisements.filter((ad) => ad.id === reviewAdId)
      : reviewCampaign.advertisements
    ).flatMap((ad) => ad.materials);
    if (scopedMaterials.length === 0) {
      return c.json({ error: advertisementId !== undefined ? `advertisement ${advertisementId} has no materials` : 'campaign has no materials' }, 400);
    }
    const id = runCampaignReview(reviewCampaign, reviewAdId);
    return c.json({
      id,
      kind: 'campaign',
      ...(advertisementId !== undefined ? { advertisementId } : {}),
      ...(materialId !== undefined ? { materialId } : {}),
      materials: scopedMaterials.map((m) => m.id),
    });
  }

  // Single-asset reviews still start from band.ai in band mode (post in your room);
  // only the campaign path above is driven by the portal in band mode.
  if (BOARD_MODE === 'band') {
    return c.json(
      { error: 'In band mode, start a single-asset review from band.ai: post "Coordinator, review <asset>" in your room. Campaign reviews can be started here.' },
      400,
    );
  }

  const parsed = CreateReview.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const d = parsed.data;
  const asset: ContentAsset = {
    id: `asset-${randomUUID().slice(0, 8)}`,
    channel: d.channel,
    markets: d.markets,
    copy: d.copy,
    claim: d.claim,
    ...(d.imagePrompt ? { imagePrompt: d.imagePrompt } : {}),
    ...(d.substantiation ? { substantiation: d.substantiation } : {}),
  };

  const record: ReviewRecord = {
    id: '',
    createdAt: Date.now(),
    asset,
    events: [],
    status: 'running',
    conflict: false,
    subscribers: new Set(),
    submitDecision: async () => {},
  };
  const onEvent = makeOnEvent(record);

  const id = randomUUID();
  record.id = id;
  const roomId = `review-${id}`;
  const hostImage = (u: string): string => store.hostImage(u) ?? u;
  // Opt-in pods topology runs the blackboard pods + decision spine; classic (the
  // default) runs the coordinator/reconcile board with the multimodal perception
  // pre-pass and the key-free stub fallback.
  const session = BOARD_TOPOLOGY === 'pods'
    ? new PodBoardSession({
        roomId,
        asset,
        brand,
        rulebooks: currentRulebooks(),
        models: realPodBoardModels(),
        onEvent,
        onPrecedent: (p) => store.appendPrecedent({ roomId, regions: [], decision: `${p.decision}: ${p.claim}` }),
        hostImage,
        getPrecedents: recentPrecedents,
        getRulebook: (region) => store.getRulebookOverride(region) ?? defaultRulebooks[region.toLowerCase() as RegionKey] ?? defaultRulebooks.us,
      })
    : new BoardSession({
        roomId,
        asset,
        brand,
        rulebooks: currentRulebooks(),
        models: boardModelsOrStub(),
        onEvent,
        onPrecedent: (p) => store.appendPrecedent(p),
        hostImage,
        publishArtifact,
        getPrecedents: recentPrecedents,
        perception: perceptionConfig,
      });

  record.submitDecision = (text) => session.submitDecision(text);
  reviews.set(id, record);
  void session.run().catch((err: unknown) => {
    onEvent({ type: 'log', seq: 0, fromName: 'system', messageType: 'error', text: `Review failed: ${(err as Error)?.message ?? String(err)}` });
    onEvent({ type: 'status', seq: 0, fromName: 'system', status: 'error' });
  });
  return c.json({ id });
});

app.get('/api/reviews', (c) => {
  const byId = new Map<string, { id: string; createdAt: number; assetId: string; copy: string; markets: string[]; status: BoardStatus; conflict: boolean }>();
  for (const r of store.listReviews()) {
    byId.set(r.id, { id: r.id, createdAt: r.createdAt, assetId: r.asset.id, copy: r.asset.copy, markets: r.asset.markets, status: r.status, conflict: r.conflict });
  }
  for (const r of reviews.values()) {
    byId.set(r.id, { id: r.id, createdAt: r.createdAt, assetId: r.asset.id, copy: r.asset.copy, markets: r.asset.markets, status: r.status, conflict: r.conflict });
  }
  const list = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
  return c.json({ reviews: list, mode: BOARD_MODE, topology: BOARD_TOPOLOGY });
});

app.get('/api/reviews/:id', (c) => {
  const id = c.req.param('id');
  const record = reviews.get(id);
  if (record) return c.json({ id: record.id, status: record.status, asset: record.asset, events: record.events });
  const stored = store.getReview(id);
  if (!stored) return c.json({ error: 'not found' }, 404);
  return c.json({ id: stored.id, status: stored.status, asset: stored.asset, events: stored.events });
});

app.get('/api/reviews/:id/events', (c) => {
  const id = c.req.param('id');
  const record = reviews.get(id);
  if (!record) {
    const stored = store.getReview(id);
    if (!stored) return c.json({ error: 'not found' }, 404);
    return streamSSE(c, async (stream) => {
      for (const event of stored.events) await stream.writeSSE({ data: JSON.stringify(event) });
    });
  }
  return streamSSE(c, async (stream) => {
    for (const event of record.events) await stream.writeSSE({ data: JSON.stringify(event) });
    if (record.status === 'complete' || record.status === 'error') return;

    const queue: BoardEvent[] = [];
    let wake: (() => void) | null = null;
    const sub = (event: BoardEvent): void => {
      queue.push(event);
      if (wake) {
        wake();
        wake = null;
      }
    };
    record.subscribers.add(sub);
    try {
      for (;;) {
        if (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve));
        const event = queue.shift();
        if (!event) continue;
        await stream.writeSSE({ data: JSON.stringify(event) });
        if (event.type === 'status' && (event.status === 'complete' || event.status === 'error')) break;
      }
    } finally {
      record.subscribers.delete(sub);
    }
  });
});

app.post('/api/reviews/:id/decision', async (c) => {
  const record = reviews.get(c.req.param('id'));
  if (!record) return c.json({ error: 'not found' }, 404);
  const body: unknown = await c.req.json().catch(() => ({}));
  const decision = typeof (body as { decision?: unknown })?.decision === 'string' ? (body as { decision: string }).decision : '';
  if (!decision) return c.json({ error: 'decision required' }, 400);
  void record.submitDecision(decision).catch(() => {});
  return c.json({ ok: true });
});

app.get('/api/images/:name', (c) => {
  const buf = store.readImage(c.req.param('name'));
  if (!buf) return c.json({ error: 'not found' }, 404);
  return c.body(new Uint8Array(buf), 200, { 'content-type': imageContentType(c.req.param('name')), 'cache-control': 'public, max-age=31536000, immutable' });
});

// Serve a hosted video. Streams from disk (so large files never load fully into
// memory) and honours HTTP Range requests, which browsers use to scrub/seek a
// <video>. A missing or unreadable file is a clean 404, never a 500: the client
// then shows its graceful "preview unavailable" fallback instead of a broken icon.
app.get('/api/videos/:name', (c) => {
  try {
    const name = c.req.param('name');
    const file = store.videoFile(name);
    if (!file) return c.json({ error: 'not found' }, 404);
    const { path, size } = file;
    const contentType = videoContentType(name);
    const range = c.req.header('range');
    const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : size - 1;
      if (!Number.isFinite(start) || start < 0) start = 0;
      if (!Number.isFinite(end) || end >= size) end = size - 1;
      if (start > end || start >= size) {
        return c.body(null, 416, { 'content-range': `bytes */${size}`, 'accept-ranges': 'bytes' });
      }
      const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
      return c.body(stream, 206, {
        'content-type': contentType,
        'content-range': `bytes ${start}-${end}/${size}`,
        'accept-ranges': 'bytes',
        'content-length': String(end - start + 1),
        'cache-control': 'public, max-age=31536000, immutable',
      });
    }
    const stream = Readable.toWeb(createReadStream(path)) as ReadableStream;
    return c.body(stream, 200, {
      'content-type': contentType,
      'content-length': String(size),
      'accept-ranges': 'bytes',
      'cache-control': 'public, max-age=31536000, immutable',
    });
  } catch (err) {
    console.warn('[videos] read failed:', (err as Error)?.message ?? err);
    return c.json({ error: 'not found' }, 404);
  }
});

// Multipart video upload. Hosts the file under data/videos/ and returns its served
// url. When campaignId + materialId are included (form fields), the uploaded url is
// attached to that material's videoUrl AND the video is transcribed at upload time
// (audio extracted with ffmpeg, run through the STT client), persisting
// perception.transcript on the material so the material detail can show it right
// away. The review-time perception pre-pass (frames + vision + STT) still runs when
// a review is started and streams 'perceiving' over the existing SSE; it can refine
// this transcript. Transcription is fully graceful: no STT provider, no ffmpeg, or
// no audio track simply leaves the transcript empty and the upload still succeeds.
// Shared "the video bytes are hosted" finalize: attach the url to the material
// (when campaign + material are given) and transcribe at upload time. Used by both
// the single-shot POST /api/videos and the chunked /api/videos/finalize.
async function finalizeVideoUpload(
  videoUrl: string,
  campaignId: string,
  advertisementId: string,
  materialId: string,
): Promise<Record<string, unknown>> {
  let transcribed = false;
  if (campaignId && materialId) {
    const camp = store.getCampaign(campaignId);
    if (camp) {
      // Attach the hosted url first so the material is durable even if the
      // (best-effort) transcription below fails or finds no audio.
      const withVideo = patchMaterial(camp, materialId, (m) => ({ ...m, videoUrl }));
      store.saveCampaign(withVideo);
      // Transcribe at upload time so the material detail can show a transcript
      // without waiting for a review. Re-read the campaign before persisting so a
      // concurrent edit is not clobbered.
      transcribed = await attachTranscript(campaignId, materialId, withVideo);
    }
  }
  return {
    videoUrl,
    ...(campaignId ? { campaignId } : {}),
    ...(advertisementId ? { advertisementId } : {}),
    ...(materialId ? { materialId } : {}),
    transcribed,
  };
}

app.post('/api/videos', async (c) => {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: 'expected multipart/form-data with a "video" file' }, 400);
  }
  const file = form.get('video');
  if (!(file instanceof File)) return c.json({ error: 'missing "video" file field' }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) return c.json({ error: 'empty video file' }, 400);
  const videoUrl = store.hostVideo(bytes, extOf(file.name));
  const campaignId = typeof form.get('campaignId') === 'string' ? (form.get('campaignId') as string) : '';
  const advertisementId = typeof form.get('advertisementId') === 'string' ? (form.get('advertisementId') as string) : '';
  const materialId = typeof form.get('materialId') === 'string' ? (form.get('materialId') as string) : '';
  return c.json(await finalizeVideoUpload(videoUrl, campaignId, advertisementId, materialId));
});

// Chunked video upload, for files over Cloud Run's 32 MiB per-request cap: the
// client slices the file and POSTs each piece here as a raw octet-stream body
// (?uploadId=&index=), then calls /api/videos/finalize to assemble + transcribe.
app.post('/api/videos/chunk', async (c) => {
  const uploadId = c.req.query('uploadId') ?? '';
  const index = Number(c.req.query('index'));
  if (!/^[a-zA-Z0-9_-]{8,}$/.test(uploadId) || !Number.isInteger(index) || index < 0) {
    return c.json({ error: 'bad chunk params (need uploadId and index)' }, 400);
  }
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength === 0) return c.json({ error: 'empty chunk' }, 400);
  store.writeVideoChunk(uploadId, index, bytes);
  return c.json({ ok: true, index });
});

// Assemble an upload's chunks into one hosted video, then run the same attach +
// transcribe path as the single-shot upload.
app.post('/api/videos/finalize', async (c) => {
  let body: { uploadId?: string; fileName?: string; campaignId?: string; advertisementId?: string; materialId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'expected a json body' }, 400);
  }
  const uploadId = body.uploadId ?? '';
  if (!/^[a-zA-Z0-9_-]{8,}$/.test(uploadId)) return c.json({ error: 'missing or invalid uploadId' }, 400);
  const videoUrl = store.assembleVideoChunks(uploadId, extOf(body.fileName ?? 'video.mp4'));
  if (!videoUrl) return c.json({ error: 'no chunks found for that uploadId' }, 400);
  return c.json(
    await finalizeVideoUpload(videoUrl, body.campaignId ?? '', body.advertisementId ?? '', body.materialId ?? ''),
  );
});

// --- Chat relay: judges talk to the band.ai agents from our UI, no auth ----------
// Our server drives a real band.ai room as the INTAKE identity (see ./relay): create
// a room + add the Conductor + post on the judge's behalf, and stream the agents'
// replies back. The reviewer agents run as their own always-on process and
// self-assemble once the Conductor is @mentioned. With no relay creds these 503.

app.post('/api/rooms', async (c) => {
  if (!relayConfigured()) return c.json({ error: 'chat relay not configured' }, 503);
  const body = (await c.req.json().catch(() => ({}))) as { campaignId?: unknown; advertisementId?: unknown };
  const campaignId = typeof body.campaignId === 'string' ? body.campaignId : '';
  const advertisementId = typeof body.advertisementId === 'string' ? body.advertisementId : '';
  const campaign = campaignId ? store.getCampaign(campaignId) : undefined;
  if (!campaign) return c.json({ error: 'unknown campaignId' }, 400);
  const ad = advertisementId ? campaign.advertisements.find((a) => a.id === advertisementId) : undefined;
  try {
    const roomId = await createReviewRoom({
      campaignName: campaign.name,
      ...(ad ? { advertisementName: ad.name } : {}),
    });
    return c.json({ roomId });
  } catch (err) {
    console.warn('[rooms] create failed:', (err as Error)?.message ?? err);
    return c.json({ error: 'could not start the chat (band.ai relay unavailable)' }, 502);
  }
});

app.post('/api/rooms/:id/messages', async (c) => {
  if (!relayConfigured()) return c.json({ error: 'chat relay not configured' }, 503);
  const roomId = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { text?: unknown };
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return c.json({ error: 'text required' }, 400);
  try {
    await postUserMessage(roomId, text);
    return c.json({ ok: true });
  } catch (err) {
    console.warn('[rooms] post failed:', (err as Error)?.message ?? err);
    return c.json({ error: 'could not send the message' }, 502);
  }
});

// SSE stream of a room's messages (agent replies + our posts). Polls band.ai every
// ~2s and emits each not-yet-seen message; a periodic ping keeps the connection open.
app.get('/api/rooms/:id/events', (c) => {
  if (!relayConfigured()) return c.json({ error: 'chat relay not configured' }, 503);
  const roomId = c.req.param('id');
  return streamSSE(c, async (stream) => {
    const seen = new Set<string>();
    let aborted = false;
    stream.onAbort(() => {
      aborted = true;
    });
    while (!aborted) {
      try {
        const fresh = selectNewMessages(seen, await listRoomMessages(roomId));
        for (const m of fresh) await stream.writeSSE({ data: JSON.stringify(m) });
      } catch (err) {
        await stream.writeSSE({ event: 'poll-error', data: JSON.stringify({ message: (err as Error)?.message ?? 'poll failed' }) }).catch(() => {});
      }
      await stream.writeSSE({ event: 'ping', data: '' }).catch(() => {});
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
    }
  });
});

// Multipart image upload. Hosts the file under data/images/ and returns its served
// url. When campaignId + materialId are included, the url is attached to that
// material's imageUrl (so the perception pre-pass treats it as the single frame).
app.post('/api/images', async (c) => {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: 'expected multipart/form-data with an "image" file' }, 400);
  }
  const file = form.get('image');
  if (!(file instanceof File)) return c.json({ error: 'missing "image" file field' }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) return c.json({ error: 'empty image file' }, 400);
  const imageUrl = store.hostImageBytes(bytes, extOf(file.name, 'png'));

  const campaignId = typeof form.get('campaignId') === 'string' ? (form.get('campaignId') as string) : '';
  const materialId = typeof form.get('materialId') === 'string' ? (form.get('materialId') as string) : '';
  if (campaignId && materialId) {
    const camp = store.getCampaign(campaignId);
    if (camp) store.saveCampaign(patchMaterial(camp, materialId, (m) => ({ ...m, imageUrl })));
  }
  return c.json({ imageUrl, ...(campaignId ? { campaignId } : {}), ...(materialId ? { materialId } : {}) });
});

// Append a source to a campaign's dossier so it cascades into every reviewer
// prompt. Two ways in: a multipart upload (a "file" field, .md/.txt/.json) OR a
// JSON body { name, kind, content }. The kind is inferred from the file
// extension on upload, or taken from the body. Both endpoints below share this.
async function addDossierSource(c: Context): Promise<Response> {
  const camp = store.getCampaign(c.req.param('id') ?? '');
  if (!camp) return c.json({ error: 'not found' }, 404);

  let source: { name: string; kind: 'md' | 'json' | 'text'; content: string } | undefined;
  const contentType = c.req.header('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ error: 'expected multipart/form-data with a "file" field' }, 400);
    }
    const file = form.get('file');
    if (!(file instanceof File)) return c.json({ error: 'missing "file" field' }, 400);
    const content = await file.text();
    const ext = extOf(file.name, 'text');
    const kind: 'md' | 'json' | 'text' = ext === 'md' ? 'md' : ext === 'json' ? 'json' : 'text';
    source = { name: file.name || `source-${randomUUID().slice(0, 6)}`, kind, content };
  } else {
    // JSON body: { name?, kind?, content }. content is required; kind defaults to text.
    const parsed = DossierSourceBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    source = {
      name: parsed.data.name ?? `source-${randomUUID().slice(0, 6)}`,
      kind: parsed.data.kind ?? 'text',
      content: parsed.data.content,
    };
  }

  const next: Campaign = {
    ...camp,
    dossier: { ...camp.dossier, sources: [...camp.dossier.sources, source] },
  };
  store.saveCampaign(next);
  return c.json({ campaign: next, source });
}

// TASK-spec path. Accepts a multipart .md/.txt/.json upload or a JSON body.
app.post('/api/campaigns/:id/dossier/sources', (c) => addDossierSource(c));

// Back-compat alias (the same handler) used by the earlier multipart upload path.
app.post('/api/campaigns/:id/dossier-sources', (c) => addDossierSource(c));

// Artifacts: agents publish images/reports here and paste the viewer URL into
// the room; the /a/:id dashboard page fetches GET /api/artifacts/:id to render.
app.post('/api/artifacts', async (c) => {
  const body: unknown = await c.req.json().catch(() => ({}));
  const parsed = NewArtifactSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const published = publishArtifact(parsed.data);
  return c.json(published);
});

app.get('/api/artifacts/:id', (c) => {
  const artifact = store.getArtifact(c.req.param('id'));
  if (!artifact) return c.json({ error: 'not found' }, 404);
  return c.json({ artifact });
});

app.get('/api/precedents', (c) => c.json({ precedents: store.listPrecedents() }));

// Live, in-memory estimate of model spend since the server started.
// Read the shared file so the UI reflects spend from the pnpm agents runner too,
// falling back to this process's own in-memory tally.
app.get('/api/spending', (c) => c.json(readSpendSnapshot(SPEND_FILE) ?? spend.snapshot()));

app.get('/api/assets', (c) => c.json({ assets: store.listAssets() }));

app.post('/api/assets', async (c) => {
  const body: unknown = await c.req.json().catch(() => ({}));
  const candidate = (body as { id?: unknown })?.id ? body : { ...(body as object), id: `asset-${randomUUID().slice(0, 8)}` };
  const parsed = ContentAssetSchema.safeParse(candidate);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  store.saveAsset(parsed.data);
  return c.json({ asset: parsed.data });
});

// --- Campaigns -----------------------------------------------------------
// The saved campaign library. A Campaign holds Advertisements, each holding
// Materials. listCampaigns also surfaces legacy single assets as one-advertisement
// campaigns, so existing data still appears (store back-compat).

app.get('/api/campaigns', (c) => {
  const list = store
    .listCampaigns()
    .map((camp) => ({ id: camp.id, name: camp.name, markets: camp.markets, advertisementCount: camp.advertisements.length, materialCount: materialCount(camp) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return c.json({ campaigns: list });
});

app.get('/api/campaigns/:id', (c) => {
  const camp = store.getCampaign(c.req.param('id'));
  if (!camp) return c.json({ error: 'not found' }, 404);
  return c.json({ campaign: camp });
});

app.post('/api/campaigns', async (c) => {
  const body: unknown = await c.req.json().catch(() => ({}));
  const candidate = (body as { id?: unknown })?.id ? body : { ...(body as object), id: `camp-${randomUUID().slice(0, 8)}` };
  const parsed = CampaignSchema.safeParse(candidate);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  store.saveCampaign(parsed.data);
  return c.json({ campaign: parsed.data });
});

// Add an advertisement to an existing campaign (id auto-assigned when absent).
// Advertisements can be added at any time, including after a review completes.
app.post('/api/campaigns/:id/advertisements', async (c) => {
  const camp = store.getCampaign(c.req.param('id'));
  if (!camp) return c.json({ error: 'not found' }, 404);
  const body: unknown = await c.req.json().catch(() => ({}));
  const candidate = (body as { id?: unknown })?.id ? body : { ...(body as object), id: `ad-${randomUUID().slice(0, 8)}` };
  const parsed = AdvertisementSchema.safeParse(candidate);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const next = { ...camp, advertisements: [...camp.advertisements.filter((ad) => ad.id !== parsed.data.id), parsed.data] };
  store.saveCampaign(next);
  return c.json({ campaign: next, advertisement: parsed.data });
});

// Add a material to a campaign under a target advertisement. Both ids are
// auto-assigned when absent. The target advertisement can be given in the URL
// (POST .../advertisements/:adId/materials) or in the body (advertisementId);
// when neither is given it defaults to the first advertisement. Materials can be
// added at ANY time, including after a review has completed (no status gate).
async function addMaterial(c: Context, advertisementIdFromPath?: string): Promise<Response> {
  const camp = store.getCampaign(c.req.param('id') ?? '');
  if (!camp) return c.json({ error: 'not found' }, 404);
  // A path-addressed advertisement must exist; a typo should 404, not silently
  // fall through to the first advertisement.
  if (advertisementIdFromPath !== undefined && !camp.advertisements.some((ad) => ad.id === advertisementIdFromPath)) {
    return c.json({ error: `advertisement ${advertisementIdFromPath} not found` }, 404);
  }
  const body: unknown = await c.req.json().catch(() => ({}));
  const advertisementId = advertisementIdFromPath
    ?? (typeof (body as { advertisementId?: unknown })?.advertisementId === 'string'
      ? (body as { advertisementId: string }).advertisementId
      : undefined);
  const candidate = (body as { id?: unknown })?.id ? body : { ...(body as object), id: `mat-${randomUUID().slice(0, 8)}` };
  const parsed = MaterialSchema.safeParse(candidate);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const next = addMaterialToCampaign(camp, parsed.data, advertisementId);
  store.saveCampaign(next);
  return c.json({ campaign: next, material: parsed.data });
}

// Body carries the (optional) advertisementId; defaults to the first ad.
app.post('/api/campaigns/:id/materials', (c) => addMaterial(c));

// The advertisement is addressed in the URL path (TASK spec). Add-anytime.
app.post('/api/campaigns/:id/advertisements/:adId/materials', (c) => addMaterial(c, c.req.param('adId')));

// A band.ai per-material verdict lands here, so the dashboard reflects the review
// (status + report link) on the material even though the review ran in the separate
// agents process. Finds the material across campaigns (legacy single assets are
// surfaced as one-material campaigns) by id and persists the verdict on it.
app.post('/api/materials/:materialId/review', async (c) => {
  const materialId = c.req.param('materialId') ?? '';
  const body: unknown = await c.req.json().catch(() => ({}));
  const parsed = MaterialReviewSchema.omit({ reviewedAt: true }).safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const review = { ...parsed.data, reviewedAt: Date.now() };
  const camp = store.listCampaigns().find((cp) => cp.advertisements.some((ad) => ad.materials.some((m) => m.id === materialId)));
  if (!camp) return c.json({ error: 'material not found' }, 404);
  store.saveCampaign(patchMaterial(camp, materialId, (m) => ({ ...m, review })));
  return c.json({ ok: true, campaignId: camp.id, materialId, review });
});

// --- Live run mirror (Stage B): the band.ai agents POST a run when a review starts
// and append one lifecycle event per beat; the dashboard subscribes (SSE) and lists
// them. This is the visible bridge between band.ai and the UI. See src/domain/runs.ts. ---

// Open a run (the Conductor calls this when a human asks for a review in band.ai).
app.post('/api/runs', async (c) => {
  const body: unknown = await c.req.json().catch(() => ({}));
  const parsed = CreateRunSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const now = Date.now();
  const id = `run-${randomUUID().slice(0, 8)}`;
  const record: RunRecord = {
    id,
    campaignId: parsed.data.campaignId,
    ...(parsed.data.advertisementId ? { advertisementId: parsed.data.advertisementId } : {}),
    ...(parsed.data.materialId ? { materialId: parsed.data.materialId } : {}),
    label: parsed.data.label ?? 'Review',
    status: 'running',
    createdAt: now,
    updatedAt: now,
    events: [],
    subscribers: new Set(),
  };
  runs.set(id, record);
  // Bound memory: drop the oldest runs beyond MAX_RUNS.
  if (runs.size > MAX_RUNS) {
    for (const r of [...runs.values()].sort((a, b) => a.createdAt - b.createdAt).slice(0, runs.size - MAX_RUNS)) {
      runs.delete(r.id);
    }
  }
  return c.json({ id, run: toRunSummary(record) });
});

// Append a lifecycle event to a run (and optionally advance its status).
app.post('/api/runs/:id/events', async (c) => {
  const record = runs.get(c.req.param('id'));
  if (!record) return c.json({ error: 'not found' }, 404);
  const body: unknown = await c.req.json().catch(() => ({}));
  const parsed = RunEventInputSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const event = appendRunEvent(record, parsed.data);
  return c.json({ ok: true, event, status: record.status });
});

// The full run (timeline) for the UI.
app.get('/api/runs/:id', (c) => {
  const record = runs.get(c.req.param('id'));
  if (!record) return c.json({ error: 'not found' }, 404);
  const { subscribers, ...run } = record;
  void subscribers;
  return c.json({ run });
});

// Recent runs for a campaign (summaries, newest first), so the dashboard can list them.
app.get('/api/campaigns/:id/runs', (c) => {
  const campaignId = c.req.param('id');
  // Map preserves creation order (oldest -> newest); reverse = newest first, stable
  // even when several runs are created within the same millisecond.
  const list = [...runs.values()]
    .filter((r) => r.campaignId === campaignId)
    .reverse()
    .map(toRunSummary);
  return c.json({ runs: list });
});

// Live SSE stream of a run's events: replay what happened, then stream new beats,
// closing when the run reaches a terminal status (complete / error).
app.get('/api/runs/:id/events', (c) => {
  const record = runs.get(c.req.param('id'));
  if (!record) return c.json({ error: 'not found' }, 404);
  // status is mutated asynchronously by appendRunEvent; read it through a helper so
  // TS does not narrow it away after the early-return guard.
  const isTerminal = (): boolean => record.status === 'complete' || record.status === 'error';
  return streamSSE(c, async (stream) => {
    for (const event of record.events) await stream.writeSSE({ data: JSON.stringify(event) });
    if (isTerminal()) return;
    const queue: RunEvent[] = [];
    let wake: (() => void) | null = null;
    const sub = (event: RunEvent): void => {
      queue.push(event);
      if (wake) {
        wake();
        wake = null;
      }
    };
    record.subscribers.add(sub);
    try {
      for (;;) {
        if (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve));
        const event = queue.shift();
        if (!event) continue;
        await stream.writeSSE({ data: JSON.stringify(event) });
        if (isTerminal()) break;
      }
    } finally {
      record.subscribers.delete(sub);
    }
  });
});

// Campaign review state for the UI: status, the observational rollup (worst-case
// per region + the material x region matrix), and the full event stream.
app.get('/api/campaign-reviews/:id', (c) => {
  const record = campaignReviews.get(c.req.param('id'));
  if (!record) return c.json({ error: 'not found' }, 404);
  return c.json({
    id: record.id,
    status: record.status,
    campaign: record.campaign,
    rollup: record.rollup,
    events: record.events,
  });
});

app.get('/api/campaign-reviews/:id/events', (c) => {
  const id = c.req.param('id');
  const record = campaignReviews.get(id);
  if (!record) return c.json({ error: 'not found' }, 404);
  return streamSSE(c, async (stream) => {
    for (const event of record.events) await stream.writeSSE({ data: JSON.stringify(event) });
    if (record.status === 'complete' || record.status === 'error') return;

    const queue: BoardEvent[] = [];
    let wake: (() => void) | null = null;
    const sub = (event: BoardEvent): void => {
      queue.push(event);
      if (wake) {
        wake();
        wake = null;
      }
    };
    record.subscribers.add(sub);
    try {
      for (;;) {
        if (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve));
        const event = queue.shift();
        if (!event) continue;
        await stream.writeSSE({ data: JSON.stringify(event) });
        // Only a campaign-level terminal (no materialId) closes the stream; a
        // per-material status event keeps it open so the other lanes keep flowing.
        if (event.type === 'status' && event.materialId === undefined && (event.status === 'complete' || event.status === 'error')) break;
      }
    } finally {
      record.subscribers.delete(sub);
    }
  });
});

// A human ruling on one material's escalation inside a campaign review.
app.post('/api/campaign-reviews/:id/decision', async (c) => {
  const record = campaignReviews.get(c.req.param('id'));
  if (!record) return c.json({ error: 'not found' }, 404);
  const body: unknown = await c.req.json().catch(() => ({}));
  const materialId = typeof (body as { materialId?: unknown })?.materialId === 'string' ? (body as { materialId: string }).materialId : '';
  const decision = typeof (body as { decision?: unknown })?.decision === 'string' ? (body as { decision: string }).decision : '';
  if (!materialId || !decision) return c.json({ error: 'materialId and decision required' }, 400);
  void record.submitDecision(materialId, decision).catch(() => {});
  return c.json({ ok: true });
});

app.get('/api/rulebooks', (c) => {
  const current = currentRulebooks();
  return c.json({ rulebooks: REGIONS.map((r) => current[r]) });
});

// Curated one-click rulebook presets (US-FTC, EU health claims, LATAM). Read-only;
// the picked preset is applied via the existing PUT /api/rulebooks/:region.
app.get('/api/rulebooks/presets', (c) => {
  const presets = loadPresets(PRESETS_DIR).map((p) => ({ id: p.id, label: p.label, region: p.region, rulebook: p.rulebook }));
  return c.json({ presets });
});

app.get('/api/rulebooks/:region', (c) => {
  const region = c.req.param('region').toLowerCase();
  if (!(REGIONS as readonly string[]).includes(region)) return c.json({ error: 'unknown region' }, 404);
  return c.json({ rulebook: currentRulebooks()[region as RegionKey] });
});

app.put('/api/rulebooks/:region', async (c) => {
  const region = c.req.param('region').toLowerCase();
  if (!(REGIONS as readonly string[]).includes(region)) return c.json({ error: 'unknown region' }, 404);
  const body: unknown = await c.req.json().catch(() => ({}));
  const parsed = RulebookSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  store.saveRulebookOverride(region, parsed.data);
  return c.json({ rulebook: parsed.data });
});

// Smart rulebook import. The result is a PROPOSAL for the user to confirm: it is
// NOT persisted here. The user reviews the returned rulebook and saves it with
// the PUT above. json => validate the content directly (no model call). md/text
// => parse with the AIML-default model into structured Rule[] (the same
// structured-output path the reviewers use), honoring MODEL_MODE.
const ImportBody = z.object({
  format: z.enum(['md', 'json', 'text']),
  content: z.string().min(1),
  label: z.string().optional(),
});

app.post('/api/rulebooks/:region/import', async (c) => {
  const region = c.req.param('region').toLowerCase();
  if (!(REGIONS as readonly string[]).includes(region)) return c.json({ error: 'unknown region' }, 404);
  const body: unknown = await c.req.json().catch(() => ({}));
  const parsed = ImportBody.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const { format, content, label } = parsed.data;
  try {
    const rulebook = await importRulebook({
      format: format as ImportFormat,
      content,
      region,
      ...(label ? { label } : {}),
      // The model is only constructed for md/text; a json import never calls it.
      ...(format === 'json' ? {} : { model: importModel() }),
    });
    return c.json({ rulebook });
  } catch (err: unknown) {
    return c.json({ error: (err as Error)?.message ?? 'rulebook import failed' }, 400);
  }
});

if (existsSync(WEB_DIST)) {
  app.use('/*', serveStatic({ root: './web/dist' }));
  app.get('*', serveStatic({ path: './web/dist/index.html' }));
} else {
  app.get('/', (c) =>
    c.text('Campaign portal backend is running. Build the UI: cd web && pnpm install && pnpm build, or run cd web && pnpm dev. API is under /api.'),
  );
}

// The Hono app and the store are exported so tests can drive the routes via
// app.fetch without binding a port (run tests with BOARD_MODE=local). Importing
// this module has no side effects: the server only binds, and band.ai agents only
// connect, when run as the entrypoint (npm run serve / dev:server) via main().
export { app, store };

async function main(): Promise<void> {
  // Restore persisted state before serving or connecting agents (disk is
  // ephemeral on Cloud Run). Best effort: a first run with an empty bucket, or a
  // transient GCS error, falls back to whatever is on local disk.
  if (GCS_BUCKET) {
    try {
      const n = await restoreFromGcs(GCS_BUCKET, DATA_DIR, GCS_PREFIX);
      console.log(`Restored ${n} file(s) from gs://${GCS_BUCKET}/${GCS_PREFIX}`);
    } catch (err) {
      console.error('[gcs-backup] restore failed (continuing with local state):', (err as Error)?.message ?? err);
    }
  }
  bandBoard = buildBandBoard();
  if (bandBoard) {
    console.log('Connecting band.ai agents (BOARD_MODE=band). This is the real coordination layer...');
    await bandBoard.start();
    console.log('band.ai agents connected and waiting for campaigns.');
  }
  serve({ fetch: app.fetch, port: PORT });
  console.log(`Campaign portal on http://localhost:${PORT} (BOARD_MODE=${BOARD_MODE}, MODEL_MODE=${process.env.MODEL_MODE ?? 'aiml'})`);
}

// Run the server only when this file is the process entrypoint, not on import.
const isEntrypoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
