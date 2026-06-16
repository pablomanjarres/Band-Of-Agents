import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';
import type { CompleteRequest, CompleteResult, Msg, ModelClient } from './client';
import { withRetry } from './retry';

export interface BedrockOptions {
  model: string;
  region?: string;
  maxTokens?: number;
}

// Map our provider-agnostic content to the Anthropic message-content format. A
// plain string stays a plain string (byte-identical to before the multimodal
// seam); an array of blocks becomes Anthropic content blocks (text + a url image
// source). Typed loosely at the boundary so it stays valid across SDK versions.
type AnthropicContent =
  | string
  | Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'url'; url: string } }>;

export function toAnthropicContent(content: Msg['content']): AnthropicContent {
  if (typeof content === 'string') return content;
  return content.map((b) =>
    b.type === 'image'
      ? ({ type: 'image' as const, source: { type: 'url' as const, url: b.url } })
      : ({ type: 'text' as const, text: b.text }),
  );
}

// Claude on AWS Bedrock via Anthropic's official Bedrock SDK. A dev-time
// cost-saver behind the model seam; reads ~/.aws credentials (AWS_REGION must
// be set, the SDK does not read ~/.aws/config for region).
export class BedrockModelClient implements ModelClient {
  readonly model: string;
  private readonly client: AnthropicBedrock;
  private readonly defaultMaxTokens: number;

  constructor(opts: BedrockOptions) {
    this.model = opts.model;
    this.defaultMaxTokens = opts.maxTokens ?? 2048;
    this.client = new AnthropicBedrock({ awsRegion: opts.region ?? process.env.AWS_REGION ?? 'us-east-1' });
  }

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const messages = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: toAnthropicContent(m.content),
      }));

    const res = await withRetry(() =>
      this.client.messages.create({
        model: this.model,
        max_tokens: req.maxTokens ?? this.defaultMaxTokens,
        ...(req.system ? { system: req.system } : {}),
        messages,
      }),
    );

    let text = '';
    for (const block of res.content) {
      if (block.type === 'text') text += block.text;
    }
    const usage = { usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens } };
    if (!req.jsonSchema) return { text, ...usage };
    try {
      return { text, json: JSON.parse(text), ...usage };
    } catch {
      return { text, ...usage };
    }
  }
}
