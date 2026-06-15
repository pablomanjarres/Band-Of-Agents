// Provider-agnostic model interface. The AIML adapter (main path), Bedrock,
// Gemini, and Featherless adapters all implement this, so agents never know
// which provider they run on. A deterministic stub is provided for tests.

/**
 * A single piece of message content. The multimodal seam: a message is either a
 * plain string (the text-only path, unchanged from before) or an ordered list of
 * blocks mixing text and images. Only the perception pre-pass sends image blocks;
 * every existing text call keeps passing a string and behaves identically.
 */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string };

export interface Msg {
  role: 'system' | 'user' | 'assistant';
  /** A plain string (text-only, unchanged) or content blocks (text + images). */
  content: string | ContentBlock[];
}

export interface CompleteRequest {
  system?: string;
  messages: Msg[];
  /** JSON schema for structured output; adapters shape it per provider. */
  jsonSchema?: unknown;
  effort?: 'low' | 'medium' | 'high';
  maxTokens?: number;
}

export interface CompleteResult {
  text: string;
  /** Present when jsonSchema was supplied and the output parsed as JSON. */
  json?: unknown;
}

export interface ImageRequest {
  prompt: string;
  aspectRatio?: string;
}

export interface ImageResult {
  url?: string;
  b64?: string;
}

/** Audio handed to a speech-to-text model: raw bytes plus a content-type hint. */
export interface SttRequest {
  /** The audio (or video container) bytes to transcribe. */
  audio: Uint8Array;
  /** A filename so the provider can sniff the container (e.g. "clip.mp4"). */
  filename?: string;
  /** MIME type of the bytes (e.g. "video/mp4", "audio/mpeg"). */
  contentType?: string;
}

export interface SttResult {
  /** The transcript text (empty string when nothing could be transcribed). */
  text: string;
}

/**
 * A speech-to-text client (Whisper-class). Separate from ModelClient because it
 * is an audio-transcription endpoint, not a chat completion. A deterministic stub
 * is provided for tests so the perception pass runs with no network or audio.
 */
export interface SttClient {
  readonly model: string;
  transcribe(req: SttRequest): Promise<SttResult>;
}

export interface ModelClient {
  readonly model: string;
  complete(req: CompleteRequest): Promise<CompleteResult>;
  /** Only the AIML adapter implements image generation (Nano Banana). */
  generateImage?(req: ImageRequest): Promise<ImageResult>;
}

// --- Content normalizers (shared by every adapter and the stub) ------------
//
// A string MUST stay a string everywhere: isPlainText short-circuits so the
// existing text payloads are byte-identical to before this seam existed. The
// array helpers only matter once an image block is present.

/** True when the content is the legacy plain-string form. */
export function isPlainText(content: string | ContentBlock[]): content is string {
  return typeof content === 'string';
}

/** True when the content carries at least one image block. */
export function hasImage(content: string | ContentBlock[]): boolean {
  return Array.isArray(content) && content.some((b) => b.type === 'image');
}

/** Normalize either form into an ordered ContentBlock[] (text wraps to one block). */
export function toBlocks(content: string | ContentBlock[]): ContentBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return content;
}

/**
 * Collapse content to plain text for text-only providers (or as a graceful
 * fallback): a string is returned unchanged, an array's text blocks are joined
 * and each image is noted so the model still knows an image was present.
 */
export function toText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .map((b) => (b.type === 'text' ? b.text : `[image: ${b.url}]`))
    .join('\n');
}

/**
 * Deterministic model for tests: you supply a responder that maps a request to a
 * result, so reviewer/reconcile logic can be exercised with no network or keys.
 * Accepts the full Msg shape (string or content blocks); responders that only
 * read req.messages keep working unchanged.
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

/**
 * Deterministic STT for tests: a responder maps the audio request to a transcript
 * (default: a canned line), so the perception pass exercises the STT branch with
 * no network and no real audio bytes.
 */
export class StubSttClient implements SttClient {
  readonly model: string;
  private readonly responder: (req: SttRequest) => SttResult;

  constructor(responder?: (req: SttRequest) => SttResult, model = 'stub-stt') {
    this.responder = responder ?? (() => ({ text: 'stub transcript' }));
    this.model = model;
  }

  async transcribe(req: SttRequest): Promise<SttResult> {
    return this.responder(req);
  }
}
