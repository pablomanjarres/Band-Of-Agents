import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';
import type { CompleteRequest, CompleteResult, ModelClient } from './client';
import { withRetry } from './retry';

export interface BedrockOptions {
  model: string;
  region?: string;
  maxTokens?: number;
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
      .map((m) => ({ role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const), content: m.content }));

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
    if (!req.jsonSchema) return { text };
    try {
      return { text, json: JSON.parse(text) };
    } catch {
      return { text };
    }
  }
}
