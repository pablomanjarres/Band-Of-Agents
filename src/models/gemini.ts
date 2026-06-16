import { GoogleGenAI, Modality, type Content, type Part } from '@google/genai';
import type { CompleteRequest, CompleteResult, ImageRequest, ImageResult, Msg, ModelClient } from './client';
import { hasImage } from './client';
import { withRetry } from './retry';

const IMAGE_MODEL = 'gemini-2.5-flash-image';

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
      this.ai.models.generateContent({
        model: this.model,
        contents,
        config: {
          ...(req.system ? { systemInstruction: req.system } : {}),
          ...(req.jsonSchema ? { responseMimeType: 'application/json' } : {}),
        },
      }),
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
      this.ai.models.generateContent({
        model: IMAGE_MODEL,
        contents: req.prompt,
        config: { responseModalities: [Modality.IMAGE] },
      }),
    );
    const parts = res.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      const data = part.inlineData?.data;
      if (typeof data === 'string' && data.length > 0) return { b64: data };
    }
    return {};
  }
}
