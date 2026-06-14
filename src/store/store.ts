// File-backed JSON store for the console: reviews (with their event stream),
// the human-decision precedent log, a saved-asset library, and per-region
// rulebook overrides edited in the UI. Generated images are decoded out of the
// event stream and hosted as files so stored/streamed events stay small.
//
// Deliberately dependency-free (node:fs) and behind a small interface so it can
// become SQLite later without touching the server.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { BoardEvent, BoardStatus } from '../board/events';
import type { ContentAsset, Rulebook } from '../domain/types';
import type { Precedent } from '../agents/reconcile';

export interface StoredReview {
  id: string;
  createdAt: number;
  asset: ContentAsset;
  events: BoardEvent[];
  status: BoardStatus;
  conflict: boolean;
}

export class Store {
  private readonly dir: string;
  private readonly imagesDir: string;
  private readonly rulebooksDir: string;

  constructor(dir: string) {
    this.dir = dir;
    this.imagesDir = join(dir, 'images');
    this.rulebooksDir = join(dir, 'rulebooks');
    for (const d of [this.dir, this.imagesDir, this.rulebooksDir]) {
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
    writeFileSync(join(this.dir, file), JSON.stringify(value, null, 2));
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
    writeFileSync(join(this.imagesDir, name), Buffer.from(data, 'base64'));
    return `/api/images/${name}`;
  }

  readImage(name: string): Buffer | null {
    const safe = name.replace(/[^a-zA-Z0-9._-]/g, '');
    const p = join(this.imagesDir, safe);
    if (!existsSync(p)) return null;
    return readFileSync(p);
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
    writeFileSync(join(this.rulebooksDir, `${region.toLowerCase()}.json`), JSON.stringify(rulebook, null, 2));
  }
}
