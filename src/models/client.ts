// Provider-agnostic model interface. The AIML adapter (main path), Bedrock, and
// Gemini adapters all implement this, so agents never know which provider they
// run on. A deterministic stub is provided for tests.

export interface Msg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompleteRequest {
  system?: string;
  messages: Msg[];
  /** Image URLs (http(s) or data URL) passed as vision INPUT; only image-capable adapters (AIML) use them. */
  images?: string[];
  /** JSON schema for structured output; adapters shape it per provider. */
  jsonSchema?: unknown;
  effort?: 'low' | 'medium' | 'high';
  maxTokens?: number;
}

/** Approximate token counts a provider reports for one completion, used to estimate spend. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompleteResult {
  text: string;
  /** Present when jsonSchema was supplied and the output parsed as JSON. */
  json?: unknown;
  /** Provider-reported token usage when available; omitted by the stub and any adapter that lacks counts. */
  usage?: TokenUsage;
}

export interface ImageRequest {
  prompt: string;
  aspectRatio?: string;
}

export interface ImageResult {
  url?: string;
  b64?: string;
}

export interface ModelClient {
  readonly model: string;
  complete(req: CompleteRequest): Promise<CompleteResult>;
  /** Only the AIML adapter implements image generation (Nano Banana). */
  generateImage?(req: ImageRequest): Promise<ImageResult>;
}

/**
 * Deterministic model for tests: you supply a responder that maps a request to a
 * result, so reviewer/reconcile logic can be exercised with no network or keys.
 */
export class StubModelClient implements ModelClient {
  readonly model: string;
  private readonly responder: (req: CompleteRequest) => CompleteResult;

  constructor(responder: (req: CompleteRequest) => CompleteResult, model = 'stub') {
    this.responder = responder;
    this.model = model;
  }

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    return this.responder(req);
  }
}
