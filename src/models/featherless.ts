import OpenAI from 'openai';
import type { CompleteRequest, CompleteResult, ModelClient } from './client';
import { toOpenAIContent } from './aiml';
import { withRetry } from './retry';

export interface FeatherlessOptions {
  apiKey: string;
  model: string;
  baseURL?: string;
}

const DEFAULT_BASE_URL = 'https://api.featherless.ai/v1';

// Featherless serves open-source models behind an OpenAI-compatible API, so one
// openai client drives it by swapping the base URL. Used for the open-model
// reviewer (targets the Featherless partner prize). Shares the OpenAI content
// mapping with the AIML adapter: a string stays a string, blocks become parts.
export class FeatherlessModelClient implements ModelClient {
  readonly model: string;
  private readonly client: OpenAI;

  constructor(opts: FeatherlessOptions) {
    this.model = opts.model;
    this.client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL ?? DEFAULT_BASE_URL });
  }

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const messages = [
      ...(req.system ? [{ role: 'system', content: req.system }] : []),
      ...req.messages.map((m) => ({ role: m.role, content: toOpenAIContent(m.content) })),
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
}
