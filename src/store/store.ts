// File-backed JSON store for the console: reviews (with their event stream),
// the human-decision precedent log, a saved-asset library, and per-region
// rulebook overrides edited in the UI. Generated images are decoded out of the
// event stream and hosted as files so stored/streamed events stay small.
//
// Deliberately dependency-free (node:fs) and behind a small interface so it can
// become SQLite later without touching the server.

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { BoardEvent, BoardStatus } from '../board/events';
import type { Campaign, ContentAsset, Material, Rulebook } from '../domain/types';
import { Campaign as CampaignSchema, normalizeCampaign } from '../domain/types';
import type { Artifact } from '../domain/artifact';
import type { Precedent } from '../agents/reconcile';

export interface StoredReview {
  id: string;
  createdAt: number;
  asset: ContentAsset;
  events: BoardEvent[];
  status: BoardStatus;
  conflict: boolean;
  /** Campaign coordinates when the review is one material of a campaign (absent for single-asset reviews). */
  campaignId?: string;
  materialId?: string;
}

export class Store {
  private readonly dir: string;
  private readonly imagesDir: string;
  private readonly rulebooksDir: string;
  private readonly videosDir: string;
  private readonly chunksDir: string;
  // Called with the absolute path of each file just written, so a backup layer
  // (e.g. GCS mirror on Cloud Run) can persist it. Stays out of the read/write
  // hot path's correctness: it is fire-and-forget on the caller's side.
  private readonly onWrite?: (absPath: string) => void;

  constructor(dir: string, onWrite?: (absPath: string) => void) {
    this.dir = dir;
    this.imagesDir = join(dir, 'images');
    this.rulebooksDir = join(dir, 'rulebooks');
    this.videosDir = join(dir, 'videos');
    this.chunksDir = join(dir, 'videos', '.chunks');
    this.onWrite = onWrite;
    for (const d of [this.dir, this.imagesDir, this.rulebooksDir, this.videosDir, this.chunksDir]) {
      if (!existsSync(d)) mkdirSync(d, { recursive: true });
    }
  }

  private readJson<T>(file: string, fallback: T): T {
    const p = join(this.dir, file);
    if (!existsSync(p)) return fallback;
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as T;
    } catch {
      return fallback;
    }
  }

  private writeJson(file: string, value: unknown): void {
    const p = join(this.dir, file);
    writeFileSync(p, JSON.stringify(value, null, 2));
    this.onWrite?.(p);
  }

  /** Decode a base64 data URL to a hosted image file; pass through hosted URLs. */
  hostImage(url: string | undefined): string | undefined {
    if (!url) return undefined;
    const m = /^data:(image\/[a-zA-Z.+-]+);base64,(.+)$/s.exec(url);
    if (!m) return url;
    const mime = m[1] ?? 'image/png';
    const data = m[2];
    if (!data) return url;
    const ext = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'img';
    const name = `${randomUUID()}.${ext}`;
    const p = join(this.imagesDir, name);
    writeFileSync(p, Buffer.from(data, 'base64'));
    this.onWrite?.(p);
    return `/api/images/${name}`;
  }

  readImage(name: string): Buffer | null {
    const safe = name.replace(/[^a-zA-Z0-9._-]/g, '');
    const p = join(this.imagesDir, safe);
    if (!existsSync(p)) return null;
    return readFileSync(p);
  }

  /** Save raw image bytes (a multipart upload), returning the served url (/api/images/<name>). */
  hostImageBytes(bytes: Uint8Array, ext = 'png'): string {
    const safeExt = /^[a-z0-9]+$/i.test(ext) ? ext.toLowerCase() : 'png';
    const name = `${randomUUID()}.${safeExt}`;
    const p = join(this.imagesDir, name);
    writeFileSync(p, Buffer.from(bytes));
    this.onWrite?.(p); // mirror to GCS so an uploaded image survives a redeploy
    return `/api/images/${name}`;
  }

  // --- Videos --------------------------------------------------------------
  // Uploaded videos are hosted under data/videos/ and served via /api/videos/.
  // The perception pass resolves a /api/videos/<name> url back to its local file
  // (videoPath) so ffmpeg/STT can read the bytes without a network fetch.

  /** Save raw video bytes, returning the served url (/api/videos/<name>). */
  hostVideo(bytes: Uint8Array, ext = 'mp4'): string {
    const safeExt = /^[a-z0-9]+$/i.test(ext) ? ext.toLowerCase() : 'mp4';
    const name = `${randomUUID()}.${safeExt}`;
    const p = join(this.videosDir, name);
    writeFileSync(p, Buffer.from(bytes));
    this.onWrite?.(p); // mirror to GCS so an uploaded video survives a redeploy
    return `/api/videos/${name}`;
  }

  /** Local file path for a hosted video url (/api/videos/<name>), or undefined. */
  videoPath(videoUrl: string): string | undefined {
    const m = /^\/api\/videos\/(.+)$/.exec(videoUrl);
    if (!m) return undefined;
    const safe = (m[1] ?? '').replace(/[^a-zA-Z0-9._-]/g, '');
    if (!safe) return undefined;
    const p = join(this.videosDir, safe);
    return existsSync(p) ? p : undefined;
  }

  readVideo(name: string): Buffer | null {
    const safe = name.replace(/[^a-zA-Z0-9._-]/g, '');
    const p = join(this.videosDir, safe);
    if (!existsSync(p)) return null;
    return readFileSync(p);
  }

  /**
   * Resolve a hosted video name to its local file path and byte size, so the
   * serving route can stream it (HTTP Range) without reading the whole file into
   * memory. Returns null when the file is missing or unreadable (never throws).
   */
  videoFile(name: string): { path: string; size: number } | null {
    try {
      const safe = name.replace(/[^a-zA-Z0-9._-]/g, '');
      const p = join(this.videosDir, safe);
      if (!safe || !existsSync(p)) return null;
      const st = statSync(p);
      if (!st.isFile()) return null;
      return { path: p, size: st.size };
    } catch {
      return null;
    }
  }

  // --- Chunked video upload ------------------------------------------------
  // A video larger than Cloud Run's 32 MiB per-request cap is uploaded in pieces.
  // Each chunk lands in data/videos/.chunks/<uploadId>/<index>.part; on finalize
  // the parts are concatenated (in index order) into one hosted video.

  /** Write one chunk of an in-progress upload to its part file. */
  writeVideoChunk(uploadId: string, index: number, bytes: Uint8Array): void {
    const safe = uploadId.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safe || !Number.isInteger(index) || index < 0) throw new Error('invalid chunk');
    const dir = join(this.chunksDir, safe);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${index}.part`), Buffer.from(bytes));
  }

  /**
   * Concatenate an upload's chunks (in index order) into a single hosted video and
   * remove the temp parts. Returns the served url, or undefined when no chunks exist.
   */
  assembleVideoChunks(uploadId: string, ext = 'mp4'): string | undefined {
    const safe = uploadId.replace(/[^a-zA-Z0-9_-]/g, '');
    const dir = join(this.chunksDir, safe);
    if (!safe || !existsSync(dir)) return undefined;
    const parts = readdirSync(dir)
      .filter((f) => f.endsWith('.part'))
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    if (parts.length === 0) return undefined;
    const safeExt = /^[a-z0-9]+$/i.test(ext) ? ext.toLowerCase() : 'mp4';
    const name = `${randomUUID()}.${safeExt}`;
    const out = join(this.videosDir, name);
    // Append part by part so the whole video is never held in memory at once.
    writeFileSync(out, Buffer.alloc(0));
    for (const p of parts) appendFileSync(out, readFileSync(join(dir, p)));
    rmSync(dir, { recursive: true, force: true });
    this.onWrite?.(out); // mirror the assembled video to GCS so it survives a redeploy
    return `/api/videos/${name}`;
  }

  saveReview(review: StoredReview): void {
    const all = this.readJson<StoredReview[]>('reviews.json', []).filter((r) => r.id !== review.id);
    all.push(review);
    this.writeJson('reviews.json', all);
  }

  listReviews(): StoredReview[] {
    return this.readJson<StoredReview[]>('reviews.json', []);
  }

  getReview(id: string): StoredReview | undefined {
    return this.listReviews().find((r) => r.id === id);
  }

  appendPrecedent(precedent: Precedent): void {
    const all = this.readJson<Precedent[]>('precedents.json', []);
    all.push(precedent);
    this.writeJson('precedents.json', all);
  }

  listPrecedents(): Precedent[] {
    return this.readJson<Precedent[]>('precedents.json', []);
  }

  listAssets(): ContentAsset[] {
    return this.readJson<ContentAsset[]>('assets.json', []);
  }

  saveAsset(asset: ContentAsset): void {
    const all = this.listAssets().filter((a) => a.id !== asset.id);
    all.push(asset);
    this.writeJson('assets.json', all);
  }

  // --- Campaigns -----------------------------------------------------------
  // The saved campaign library lives in data/campaigns.json. Each stored record is
  // normalized on read, so a legacy flat materials[] campaign loads as a single
  // "Default" advertisement. For back-compat, any legacy single ContentAsset in
  // data/assets.json is also surfaced as a one-advertisement campaign, so existing
  // saved assets still appear and review.

  /** Saved campaigns (normalized to the advertisement tier) plus legacy single assets; saved win on id collision. */
  listCampaigns(): Campaign[] {
    const saved = this.readJson<unknown[]>('campaigns.json', []).map((c) => safeNormalize(c)).filter((c): c is Campaign => c !== null);
    const savedIds = new Set(saved.map((c) => c.id));
    const legacy = this.listAssets()
      .map((a) => assetToCampaign(a))
      .filter((c) => !savedIds.has(c.id));
    const combined = [...saved, ...legacy];
    // First-run demo seed: when nothing has been saved yet, surface the bundled
    // sample campaign (data/ is gitignored, so the durable seed ships in assets/).
    if (combined.length === 0) return this.seedCampaigns();
    return combined;
  }

  /** The bundled demo campaign (assets/sample-campaign.json), used only when the library is empty. */
  private seedCampaigns(): Campaign[] {
    // Mirror the bundled seed keyframes into data/images so the sample campaign's
    // /api/images/<name> frame URLs resolve on a fresh clone (data/ is gitignored).
    this.mirrorSeedFrames();
    const p = join(this.dir, '..', 'assets', 'sample-campaign.json');
    if (!existsSync(p)) return [];
    try {
      const raw: unknown = JSON.parse(readFileSync(p, 'utf8'));
      const list = Array.isArray(raw) ? raw : [raw];
      return list.map((c) => CampaignSchema.parse(c));
    } catch {
      return [];
    }
  }

  /** Copy any bundled assets/frames/*.{png,jpg} into data/images (missing only). */
  private mirrorSeedFrames(): void {
    const src = join(this.dir, '..', 'assets', 'frames');
    if (!existsSync(src)) return;
    try {
      for (const f of readdirSync(src)) {
        if (!/\.(png|jpe?g)$/i.test(f)) continue;
        const dest = join(this.imagesDir, f);
        if (!existsSync(dest)) copyFileSync(join(src, f), dest);
      }
    } catch {
      /* best-effort: the demo just shows no frame thumbnails if this fails */
    }
  }

  getCampaign(id: string): Campaign | undefined {
    return this.listCampaigns().find((c) => c.id === id);
  }

  saveCampaign(campaign: Campaign): void {
    const all = this.readJson<Campaign[]>('campaigns.json', []).filter((c) => c.id !== campaign.id);
    all.push(campaign);
    this.writeJson('campaigns.json', all);
  }

  getRulebookOverride(region: string): Rulebook | undefined {
    const p = join(this.rulebooksDir, `${region.toLowerCase()}.json`);
    if (!existsSync(p)) return undefined;
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as Rulebook;
    } catch {
      return undefined;
    }
  }

  saveRulebookOverride(region: string, rulebook: Rulebook): void {
    const p = join(this.rulebooksDir, `${region.toLowerCase()}.json`);
    writeFileSync(p, JSON.stringify(rulebook, null, 2));
    this.onWrite?.(p);
  }

  // Artifacts: things an agent produced (images, structured docs) that Band
  // cannot show inline. Stored small (images keep their hosted /api/images path
  // in `src`, never base64), served back to the dashboard viewer by id.
  saveArtifact(artifact: Artifact): void {
    const all = this.readJson<Artifact[]>('artifacts.json', []).filter((a) => a.id !== artifact.id);
    all.push(artifact);
    this.writeJson('artifacts.json', all);
  }

  getArtifact(id: string): Artifact | undefined {
    return this.readJson<Artifact[]>('artifacts.json', []).find((a) => a.id === id);
  }
}

/**
 * Read a legacy single ContentAsset as a one-advertisement, one-material campaign
 * so existing saved assets (and old reviews) still load under the three-tier
 * model. The material reuses every asset field and is typed as a post (the default
 * channel kind), grouped under a single "Default" advertisement; the dossier
 * starts empty (the asset's own substantiation is carried into it so the cascade
 * still has the one fact the single-asset flow had).
 */
export function assetToCampaign(asset: ContentAsset): Campaign {
  const material: Material = { ...asset, kind: 'post' };
  return {
    id: asset.id,
    name: asset.name ?? asset.id,
    markets: asset.markets,
    dossier: {
      approvedClaims: [],
      substantiation: asset.substantiation ?? '',
      approvedInfo: '',
      sources: [],
    },
    advertisements: [{ id: 'default', name: 'Default', materials: [material] }],
  };
}


/**
 * Normalize a stored campaign record into a Campaign, tolerating the legacy flat
 * `materials[]` shape (it becomes a single "Default" advertisement) and dropping
 * any record that no longer parses, so one bad row never breaks the library.
 */
function safeNormalize(raw: unknown): Campaign | null {
  try {
    return normalizeCampaign(raw);
  } catch {
    return null;
  }
}
