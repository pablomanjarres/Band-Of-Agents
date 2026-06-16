// Approximate USD spend tracking across real model calls. Every client returned
// by route.ts is wrapped in a MeteredModelClient, so each completion's token
// usage and each generated image flows into the `spend` singleton. The web
// console polls GET /api/spending to show a live running cost.
//
// Prices are rough public list estimates (USD per 1M tokens), matched by a
// case-insensitive substring on the model slug. They are NOT billing-accurate;
// the widget labels the figure "(est.)".

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { CompleteRequest, CompleteResult, ImageRequest, ImageResult, ModelClient, TokenUsage } from './client';

export interface ModelPrice {
  inputPer1M: number;
  outputPer1M: number;
  perImage?: number;
}

// Ordered substring checks: the first match wins, so put more specific slugs
// ('gpt-5', 'gemini-2.5-pro') before broader ones ('gemini'). Estimates only.
const PRICE_RULES: Array<{ match: string; price: ModelPrice }> = [
  { match: 'image', price: { inputPer1M: 0, outputPer1M: 0, perImage: 0.039 } },
  { match: 'opus', price: { inputPer1M: 15, outputPer1M: 75 } },
  { match: 'sonnet', price: { inputPer1M: 3, outputPer1M: 15 } },
  { match: 'haiku', price: { inputPer1M: 0.8, outputPer1M: 4 } },
  { match: 'gpt-5', price: { inputPer1M: 1.25, outputPer1M: 10 } },
  { match: 'gemini-2.5-pro', price: { inputPer1M: 1.25, outputPer1M: 10 } },
  { match: 'gemini', price: { inputPer1M: 0.3, outputPer1M: 2.5 } },
  { match: 'deepseek', price: { inputPer1M: 0.27, outputPer1M: 1.1 } },
  { match: 'llama', price: { inputPer1M: 0.1, outputPer1M: 0.1 } },
];

const FALLBACK_PRICE: ModelPrice = { inputPer1M: 1, outputPer1M: 3 };

/** Estimated price for a model slug via ordered case-insensitive substring match. */
export function priceFor(model: string): ModelPrice {
  const slug = model.toLowerCase();
  for (const rule of PRICE_RULES) {
    if (slug.includes(rule.match)) return rule.price;
  }
  return FALLBACK_PRICE;
}

export interface ModelSpend {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  images: number;
  usd: number;
}

export interface SpendSnapshot {
  totalUsd: number;
  calls: number;
  byModel: ModelSpend[];
}

// Accumulates estimated spend per model and in total. In-memory only: a server
// restart resets the running figure, which matches its purpose as a live gauge.
export class SpendTracker {
  private totalUsd = 0;
  private calls = 0;
  private readonly perModel = new Map<string, ModelSpend>();
  private readonly persistPath?: string;

  // With a persistPath the running total is loaded on start and saved on every
  // record, so spend accrued by a separate process (the pnpm agents runner) and
  // the server's own reviews accumulate in one shared file and survive restarts.
  constructor(persistPath?: string) {
    if (persistPath) this.persistPath = persistPath;
    if (persistPath && existsSync(persistPath)) {
      try {
        const snap = JSON.parse(readFileSync(persistPath, 'utf8')) as SpendSnapshot;
        this.totalUsd = snap.totalUsd ?? 0;
        this.calls = snap.calls ?? 0;
        for (const m of snap.byModel ?? []) this.perModel.set(m.model, { ...m });
      } catch { /* ignore a missing or corrupt file */ }
    }
  }

  private persist(): void {
    if (!this.persistPath) return;
    try { writeFileSync(this.persistPath, JSON.stringify(this.snapshot())); } catch { /* best effort */ }
  }

  private entry(model: string): ModelSpend {
    let e = this.perModel.get(model);
    if (!e) {
      e = { model, calls: 0, inputTokens: 0, outputTokens: 0, images: 0, usd: 0 };
      this.perModel.set(model, e);
    }
    return e;
  }

  record(model: string, usage: TokenUsage): void {
    const price = priceFor(model);
    const usd = (usage.inputTokens / 1e6) * price.inputPer1M + (usage.outputTokens / 1e6) * price.outputPer1M;
    const e = this.entry(model);
    e.calls += 1;
    e.inputTokens += usage.inputTokens;
    e.outputTokens += usage.outputTokens;
    e.usd += usd;
    this.calls += 1;
    this.totalUsd += usd;
    this.persist();
  }

  recordImage(model: string): void {
    // Any generated image costs the per-image estimate, even when the slug does
    // not contain "image" (the dev path generates via gemini-2.5-flash).
    const usd = priceFor(model).perImage ?? 0.039;
    const e = this.entry(model);
    e.calls += 1;
    e.images += 1;
    e.usd += usd;
    this.calls += 1;
    this.totalUsd += usd;
    this.persist();
  }

  snapshot(): SpendSnapshot {
    const byModel = [...this.perModel.values()].sort((a, b) => b.usd - a.usd);
    return { totalUsd: this.totalUsd, calls: this.calls, byModel };
  }

  reset(): void {
    this.totalUsd = 0;
    this.calls = 0;
    this.perModel.clear();
    this.persist();
  }
}

/** Read the shared spend snapshot from disk, or undefined when no file exists. */
export function readSpendSnapshot(path: string): SpendSnapshot | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SpendSnapshot;
  } catch {
    return undefined;
  }
}

/** Shared spend file: the runner and the server both accumulate here. */
export const SPEND_FILE = new URL('../../data/spend.json', import.meta.url).pathname;

/** Process-wide spend accumulator the server exposes over /api/spending. */
export const spend = new SpendTracker(SPEND_FILE);

// Decorates any ModelClient so completions and generated images are metered
// without the adapters or agents knowing. Preserves the optional generateImage
// shape: the method is only present when the inner client has it.
export class MeteredModelClient implements ModelClient {
  private readonly inner: ModelClient;
  private readonly tracker: SpendTracker;
  generateImage?: (req: ImageRequest) => Promise<ImageResult>;

  constructor(inner: ModelClient, tracker: SpendTracker = spend) {
    this.inner = inner;
    this.tracker = tracker;
    if (inner.generateImage) {
      this.generateImage = async (req: ImageRequest): Promise<ImageResult> => {
        const result = await inner.generateImage!(req);
        this.tracker.recordImage(inner.model);
        return result;
      };
    }
  }

  get model(): string {
    return this.inner.model;
  }

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const result = await this.inner.complete(req);
    if (result.usage) this.tracker.record(this.inner.model, result.usage);
    return result;
  }
}

/** Wrap a client so all of its real calls are metered into the spend singleton. */
export const meter = (c: ModelClient): ModelClient => new MeteredModelClient(c);
