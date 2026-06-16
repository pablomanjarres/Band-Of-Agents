import OpenAI from 'openai';
import { toFile } from 'openai';
import type { CompleteRequest, CompleteResult, ImageRequest, ImageResult, Msg, ModelClient, SttClient, SttRequest, SttResult } from './client';
import { withRetry } from './retry';

export interface AimlOptions {
  apiKey: string;
  model: string;
  baseURL?: string;
  imageModel?: string;
}

const DEFAULT_BASE_URL = 'https://api.aimlapi.com/v1';
const DEFAULT_IMAGE_MODEL = 'google/gemini-2.5-flash-image';

// Map our provider-agnostic content to the OpenAI chat format. A plain string
// stays a plain string (byte-identical to before the multimodal seam); an array
// of blocks becomes OpenAI content parts (text + image_url).
export function toOpenAIContent(
  content: Msg['content'],
): OpenAI.Chat.Completions.ChatCompletionContentPart[] | string {
  if (typeof content === 'string') return content;
  return content.map((b) =>
    b.type === 'image'
      ? ({ type: 'image_url' as const, image_url: { url: b.url } })
      : ({ type: 'text' as const, text: b.text }),
  );
}

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
    // Vision INPUT, two ways, both supported here:
    //  - req.images: a flat list of image URLs appended to the last user message
    //    (the reviewer/pod vision path).
    //  - per-message content blocks (Msg.content = string | ContentBlock[]):
    //    toOpenAIContent maps each message, so an image block becomes an
    //    image_url part (the perception pre-pass path).
    // A plain-string text call stays byte-identical: toOpenAIContent returns the
    // string and no req.images are present.
    const hasImages = (req.images?.length ?? 0) > 0;
    let lastUserIdx = -1;
    req.messages.forEach((m, i) => {
      if (m.role === 'user') lastUserIdx = i;
    });
    const chat = req.messages.map((m, i) => {
      const mapped = toOpenAIContent(m.content);
      if (hasImages && i === lastUserIdx) {
        // Merge the flat image URLs onto whatever this message already carried,
        // normalizing a plain string to a single text part first.
        const baseParts: OpenAI.Chat.Completions.ChatCompletionContentPart[] =
          typeof mapped === 'string' ? [{ type: 'text' as const, text: mapped }] : mapped;
        return {
          role: 'user' as const,
          content: [
            ...baseParts,
            ...req.images!.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
          ],
        };
      }
      return { role: m.role, content: mapped };
    });
    const messages = [
      ...(req.system ? [{ role: 'system', content: req.system }] : []),
      ...chat,
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
    const usage = res.usage
      ? { usage: { inputTokens: res.usage.prompt_tokens, outputTokens: res.usage.completion_tokens } }
      : {};
    if (!req.jsonSchema) return { text, ...usage };
    try {
      return { text, json: JSON.parse(text), ...usage };
    } catch {
      return { text, ...usage };
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


export interface AimlSttOptions {
  apiKey: string;
  model: string;
  baseURL?: string;
}

const DEFAULT_STT_MODEL = '#g1_whisper-large';

// Speech-to-text on AIML's OpenAI-compatible audio endpoint. One openai client
// serves it; only the model slug changes. The video container bytes are wrapped
// as a file (the provider sniffs the audio track), so a video can be transcribed
// directly without a separate audio extraction step.
export class AimlSttClient implements SttClient {
  readonly model: string;
  private readonly client: OpenAI;

  constructor(opts: AimlSttOptions) {
    this.model = opts.model;
    this.client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL ?? DEFAULT_BASE_URL });
  }

  async transcribe(req: SttRequest): Promise<SttResult> {
    const file = await toFile(req.audio, req.filename ?? 'audio.mp4', {
      ...(req.contentType ? { type: req.contentType } : {}),
    });
    const res = await withRetry(() =>
      this.client.audio.transcriptions.create({ model: this.model, file }),
    );
    return { text: typeof res.text === 'string' ? res.text : '' };
  }
}

export { DEFAULT_STT_MODEL };
