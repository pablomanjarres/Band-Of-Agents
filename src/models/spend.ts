// Approximate USD spend tracking across real model calls. Every client returned
// by route.ts is wrapped in a MeteredModelClient, so each completion's token
// usage and each generated image flows into the `spend` singleton. The web
// console polls GET /api/spending to show a live running cost.
//
// Prices are rough public list estimates (USD per 1M tokens), matched by a
// case-insensitive substring on the model slug. They are NOT billing-accurate;
// the widget labels the figure "(est.)".

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
  }

  recordImage(model: string): void {
    const usd = priceFor(model).perImage ?? 0;
    const e = this.entry(model);
    e.calls += 1;
    e.images += 1;
    e.usd += usd;
    this.calls += 1;
    this.totalUsd += usd;
  }

  snapshot(): SpendSnapshot {
    const byModel = [...this.perModel.values()].sort((a, b) => b.usd - a.usd);
    return { totalUsd: this.totalUsd, calls: this.calls, byModel };
  }

  reset(): void {
    this.totalUsd = 0;
    this.calls = 0;
    this.perModel.clear();
  }
}

/** Process-wide spend accumulator the server exposes over /api/spending. */
export const spend = new SpendTracker();

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
