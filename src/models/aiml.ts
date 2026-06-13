import OpenAI from 'openai';
import type { CompleteRequest, CompleteResult, ImageRequest, ImageResult, ModelClient } from './client';
import { withRetry } from './retry';

export interface AimlOptions {
  apiKey: string;
  model: string;
  baseURL?: string;
  imageModel?: string;
}

const DEFAULT_BASE_URL = 'https://api.aimlapi.com/v1';
const DEFAULT_IMAGE_MODEL = 'google/gemini-2.5-flash-image';

// AI/ML API is OpenAI-compatible, so one openai client serves every chat agent;
// only the model slug changes. This is the architectural main path. Image
// generation (Nano Banana) uses a separate images endpoint whose response shape
// is not the OpenAI one, so it goes through fetch.
export class AimlModelClient implements ModelClient {
  readonly model: string;
  private readonly client: OpenAI;
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly imageModel: string;

  constructor(opts: AimlOptions) {
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.baseURL = opts.baseURL ?? DEFAULT_BASE_URL;
    this.imageModel = opts.imageModel ?? DEFAULT_IMAGE_MODEL;
    this.client = new OpenAI({ apiKey: this.apiKey, baseURL: this.baseURL });
  }

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const messages = [
      ...(req.system ? [{ role: 'system', content: req.system }] : []),
      ...req.messages.map((m) => ({ role: m.role, content: m.content })),
    ] as OpenAI.Chat.Completions.ChatCompletionMessageParam[];

    const res = await withRetry(() =>
      this.client.chat.completions.create({
        model: this.model,
        messages,
        ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
        ...(req.jsonSchema ? { response_format: { type: 'json_object' as const } } : {}),
      }),
    );
    const text = res.choices[0]?.message?.content ?? '';
    if (!req.jsonSchema) return { text };
    try {
      return { text, json: JSON.parse(text) };
    } catch {
      return { text };
    }
  }

  async generateImage(req: ImageRequest): Promise<ImageResult> {
    const res = await withRetry(() =>
      fetch(`${this.baseURL}/images/generations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.imageModel,
          prompt: req.prompt,
          num_images: 1,
          aspect_ratio: req.aspectRatio ?? '1:1',
        }),
      }).then(async (r) => {
        if (!r.ok) {
          throw Object.assign(new Error(`AIML image generation failed: ${r.status}`), { status: r.status });
        }
        return (await r.json()) as { images?: Array<{ url?: string; b64_json?: string }> };
      }),
    );
    const first = res.images?.[0];
    const out: ImageResult = {};
    if (first?.url) out.url = first.url;
    if (first?.b64_json) out.b64 = first.b64_json;
    return out;
  }
}
