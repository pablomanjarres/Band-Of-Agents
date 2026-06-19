import { GoogleGenAI, Modality, type Content, type Part } from '@google/genai';
import type { CompleteRequest, CompleteResult, ImageRequest, ImageResult, Msg, ModelClient, SttClient, SttRequest, SttResult } from './client';
import { hasImage } from './client';
import { withRetry } from './retry';

const IMAGE_MODEL = 'gemini-2.5-flash-image';

// Cap concurrent Gemini calls process-wide so a fan-out review (a dozen-plus
// agents firing at once) does not burst past the per-minute Vertex quota and 429.
// Shared across every GeminiModelClient instance; tunable via env. Pair with
// withRetry's 429 backoff: the cap limits the instantaneous rate, the backoff
// spaces out whatever still gets throttled.
const GEMINI_MAX_CONCURRENCY = Math.max(1, Number(process.env.GEMINI_MAX_CONCURRENCY ?? 3));
let geminiActive = 0;
const geminiQueue: Array<() => void> = [];
async function throttleGemini<T>(fn: () => Promise<T>): Promise<T> {
  if (geminiActive >= GEMINI_MAX_CONCURRENCY) {
    await new Promise<void>((resolve) => geminiQueue.push(resolve));
  }
  geminiActive++;
  try {
    return await fn();
  } finally {
    geminiActive--;
    geminiQueue.shift()?.();
  }
}

export interface GeminiOptions {
  model: string;
  vertexai?: boolean;
  project?: string;
  location?: string;
  apiKey?: string;
}

// Map one message's content to Gemini parts. Text becomes a text part; an image
// url becomes a fileData part (Gemini's URI-based image input). Used only on the
// vision path; the text-only path keeps joining strings exactly as before.
export function toGeminiParts(content: Msg['content']): Part[] {
  if (typeof content === 'string') return [{ text: content }];
  return content.map((b): Part =>
    b.type === 'image' ? { fileData: { fileUri: b.url } } : { text: b.text },
  );
}

// Build the `contents` argument for generateContent. The text-only path is
// byte-identical to before the multimodal seam: the message strings joined with
// blank lines. Only when a message carries an image do we switch to role-tagged
// Content[] (text + fileData parts) so the image actually reaches the model.
export function buildGeminiContents(messages: Msg[]): string | Content[] {
  const anyImage = messages.some((m) => hasImage(m.content));
  if (!anyImage) {
    return messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n\n');
  }
  return messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: toGeminiParts(m.content),
  }));
}

// Gemini via GCP Vertex (dev-time cost-saver) using the unified @google/genai SDK.
// Vertex mode spends GCP credits and authenticates via Application Default
// Credentials (gcloud auth application-default login). Also exposes Nano Banana
// (gemini-2.5-flash-image) image generation as the dev image path.
export class GeminiModelClient implements ModelClient {
  readonly model: string;
  private readonly ai: GoogleGenAI;

  constructor(opts: GeminiOptions) {
    this.model = opts.model;
    const useVertex = opts.vertexai ?? (process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true');
    this.ai = useVertex
      ? new GoogleGenAI({
          vertexai: true,
          project: opts.project ?? process.env.GOOGLE_CLOUD_PROJECT,
          location: opts.location ?? process.env.GOOGLE_CLOUD_LOCATION ?? 'us-central1',
        })
      : new GoogleGenAI({ apiKey: opts.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY });
  }

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    // Text-only path is unchanged; vision path uses role-tagged parts so the
    // image actually reaches the model (see buildGeminiContents).
    const contents = buildGeminiContents(req.messages);

    const res = await withRetry(() =>
      throttleGemini(() =>
        this.ai.models.generateContent({
          model: this.model,
          contents,
          config: {
            ...(req.system ? { systemInstruction: req.system } : {}),
            ...(req.jsonSchema ? { responseMimeType: 'application/json' } : {}),
          },
        }),
      ),
    );
    const text = res.text ?? '';
    const meta = res.usageMetadata;
    const usage = meta
      ? { usage: { inputTokens: meta.promptTokenCount ?? 0, outputTokens: meta.candidatesTokenCount ?? 0 } }
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
      throttleGemini(() =>
        this.ai.models.generateContent({
          model: IMAGE_MODEL,
          contents: req.prompt,
          config: { responseModalities: [Modality.IMAGE] },
        }),
      ),
    );
    const parts = res.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      const data = part.inlineData?.data;
      if (typeof data === 'string' && data.length > 0) return { b64: data };
    }
    return {};
  }
}


export interface GeminiSttOptions {
  model: string;
  vertexai?: boolean;
  project?: string;
  location?: string;
  apiKey?: string;
}

// Speech-to-text via Gemini. Gemini is multimodal, so audio bytes can be sent as
// an inlineData part next to a "transcribe verbatim" instruction and the model
// returns the spoken words as text. This is the dev/Vertex transcription path
// (Bedrock has no Whisper endpoint), so MODEL_MODE=dev gets a working STT client
// even with no AIML key. It shares the same auth seam as GeminiModelClient
// (Vertex ADC or a Gemini API key) and degrades to an empty transcript on any
// error, so a missing key / unreachable provider never throws.
export class GeminiSttClient implements SttClient {
  readonly model: string;
  private readonly ai: GoogleGenAI;

  constructor(opts: GeminiSttOptions) {
    this.model = opts.model;
    const useVertex = opts.vertexai ?? (process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true');
    this.ai = useVertex
      ? new GoogleGenAI({
          vertexai: true,
          project: opts.project ?? process.env.GOOGLE_CLOUD_PROJECT,
          location: opts.location ?? process.env.GOOGLE_CLOUD_LOCATION ?? 'us-central1',
        })
      : new GoogleGenAI({ apiKey: opts.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY });
  }

  async transcribe(req: SttRequest): Promise<SttResult> {
    // Empty audio means nothing to transcribe: return an empty transcript rather
    // than spending a call (mirrors the perception caller passing zero bytes when
    // no local file resolved).
    if (!req.audio || req.audio.byteLength === 0) return { text: '' };
    const data = Buffer.from(req.audio).toString('base64');
    const mimeType = req.contentType ?? 'audio/mp4';
    try {
      const res = await withRetry(() =>
        throttleGemini(() =>
          this.ai.models.generateContent({
            model: this.model,
            contents: [
              {
                role: 'user',
                parts: [
                  { text: 'Transcribe this audio verbatim. Return only the spoken words as plain text, with no commentary, labels, or timestamps. If there is no speech, return an empty string.' },
                  { inlineData: { data, mimeType } },
                ],
              },
            ],
          }),
        ),
      );
      const text = res.text ?? '';
      return { text: typeof text === 'string' ? text.trim() : '' };
    } catch {
      return { text: '' };
    }
  }
}
