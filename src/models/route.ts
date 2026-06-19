import type { CompleteRequest, CompleteResult, ImageRequest, ImageResult, ModelClient, SttClient } from './client';
import { AimlModelClient, AimlSttClient, DEFAULT_STT_MODEL } from './aiml';
import { BedrockModelClient } from './bedrock';
import { GeminiModelClient, GeminiSttClient } from './gemini';
import { FeatherlessModelClient } from './featherless';
import { meter } from './spend';

export type AgentRole =
  | 'coordinator' | 'us' | 'eu' | 'latam' | 'brand' | 'reconcile' | 'remediation'
  // Blackboard-pods roles (opt-in pods topology).
  | 'scout' | 'claim' | 'precedent' | 'disclosure' | 'channel' | 'visual' | 'mediator';
/**
 * Perception is a separate concern from the reviewer roles: one vision-capable
 * model "sees" each visual material once (a pre-pass) and one Whisper-class model
 * hears the audio. Both default to AIML (the three-modalities prize signal: text,
 * image, audio) and honor MODEL_MODE, so they are kept off the reviewer ROUTES.
 */
export type PerceptionRole = 'perception-vision' | 'perception-stt';
export type ModelMode = 'aiml' | 'dev' | 'vertex';

interface RouteEntry {
  aiml: string;
  devProvider: 'bedrock' | 'gemini' | 'featherless';
  devModel: string;
}

// Each agent runs a different model (multi-model by design). On the AIML main
// path, models are spread across families by task fit to use AI/ML API to its
// fullest (GPT for claim reasoning, Gemini for strict rules, Llama for the open
// reviewer, Claude for brand voice, DeepSeek for rewriting). Dev models mirror
// what the sibling `noelle` project uses (no Opus 4.8), except LATAM which runs
// an open model via Featherless (partner prize). Note: coordinator and reconcile
// are orchestration/rule-based and do not call a model; their entries are nominal.
const ROUTES: Record<AgentRole, RouteEntry> = {
  coordinator: { aiml: 'gemini-2.5-flash', devProvider: 'gemini', devModel: 'gemini-2.5-flash' },
  us: { aiml: 'gpt-5', devProvider: 'bedrock', devModel: 'us.anthropic.claude-sonnet-4-6' },
  eu: { aiml: 'gemini-2.5-pro', devProvider: 'gemini', devModel: 'gemini-2.5-pro' },
  latam: { aiml: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', devProvider: 'featherless', devModel: 'meta-llama/Meta-Llama-3.1-8B-Instruct' },
  brand: { aiml: 'claude-haiku-4-5-20251001', devProvider: 'bedrock', devModel: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' },
  reconcile: { aiml: 'claude-opus-4-5-20251101', devProvider: 'bedrock', devModel: 'us.anthropic.claude-opus-4-6-v1' },
  remediation: { aiml: 'deepseek-chat', devProvider: 'bedrock', devModel: 'us.anthropic.claude-sonnet-4-6' },
  scout: { aiml: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', devProvider: 'featherless', devModel: 'meta-llama/Meta-Llama-3.1-8B-Instruct' },
  claim: { aiml: 'gemini-2.5-pro', devProvider: 'gemini', devModel: 'gemini-2.5-pro' },
  precedent: { aiml: 'gemini-2.5-flash', devProvider: 'gemini', devModel: 'gemini-2.5-flash' },
  disclosure: { aiml: 'claude-sonnet-4-5-20250929', devProvider: 'bedrock', devModel: 'us.anthropic.claude-sonnet-4-6' },
  channel: { aiml: 'gemini-2.5-flash', devProvider: 'gemini', devModel: 'gemini-2.5-flash' },
  visual: { aiml: 'gemini-2.5-flash', devProvider: 'gemini', devModel: 'gemini-2.5-flash' },
  mediator: { aiml: 'claude-opus-4-5-20251101', devProvider: 'bedrock', devModel: 'us.anthropic.claude-opus-4-6-v1' },
};

const IMAGE_AIML_MODEL = 'gemini-2.5-flash-image';

// Perception model defaults (AIML, the three-modalities path). Both are
// env-overridable so the exact AIML catalog slug can be swapped without a code
// change. AIML_VISION_MODEL is a vision-capable chat model (image_url parts);
// AIML_STT_MODEL is a Whisper-class transcription model.
const PERCEPTION_VISION_AIML = () => process.env.AIML_VISION_MODEL ?? 'gpt-5';
const PERCEPTION_STT_AIML = () => process.env.AIML_STT_MODEL ?? DEFAULT_STT_MODEL;
// dev-mode (cost-saver) perception models: Gemini sees, Whisper-on-AIML still
// hears (Bedrock has no Whisper endpoint, so STT stays on AIML when a key exists).
const PERCEPTION_VISION_DEV = 'gemini-2.5-flash';
// dev-mode (cost-saver) STT model: Gemini can transcribe audio (inlineData), so a
// dev run with no AIML key still gets a working STT client (Bedrock has no Whisper
// endpoint). Env-overridable so the exact Gemini slug can change without a code edit.
const PERCEPTION_STT_DEV = () => process.env.GEMINI_STT_MODEL ?? 'gemini-2.5-flash';

export function activeMode(): ModelMode {
  if (process.env.MODEL_MODE === 'dev') return 'dev';
  if (process.env.MODEL_MODE === 'vertex') return 'vertex';
  return 'aiml';
}

// True when a Gemini provider is reachable without an AIML key: either Vertex is
// configured (a service account on Cloud Run, or ADC locally) or a Gemini API key
// is present. Used so the perception pre-pass (vision + STT) still runs on GCP auth
// alone, even on the AIML route with no AIML key (e.g. the hosted Cloud Run app,
// where reviewers are stubbed but uploaded videos must still be transcribed).
function geminiReachable(): boolean {
  return (
    process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true' ||
    Boolean(process.env.GEMINI_API_KEY) ||
    Boolean(process.env.GOOGLE_API_KEY)
  );
}

// AIML is the billed/showcase provider, with a Vertex Gemini fallback for when the
// AIML credit/tokens run out: the call transparently completes on Gemini, but `model`
// stays the AI/ML API model name, so spend + the dashboard keep attributing the agent
// to its AI/ML API model (gpt-5, claude-opus, deepseek, gemini, llama...). The review
// never dies just because AIML is exhausted.
// A slow/hanging AIML call (no error, just no response) must ALSO fall back, or it
// stalls the whole review; race the primary against a timeout so a hang throws and
// the fallback kicks in. 404s (bad model slug) already throw fast.
const AIML_TIMEOUT_MS = Number(process.env.AIML_TIMEOUT_MS ?? 22000);
// Image generation legitimately takes longer than a text turn (Nano Banana ~15-40s),
// so it gets its own, larger budget. Without a timeout a silent AIML image hang never
// falls back and the Remediation agent ships an empty image (no "regenerated visual").
const AIML_IMAGE_TIMEOUT_MS = Number(process.env.AIML_IMAGE_TIMEOUT_MS ?? 45000);
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`AIML call timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

class FallbackModelClient implements ModelClient {
  readonly model: string;
  constructor(private readonly primary: ModelClient, private readonly fallback: ModelClient) {
    this.model = primary.model;
  }
  async complete(req: CompleteRequest): Promise<CompleteResult> {
    try {
      return await withTimeout(this.primary.complete(req), AIML_TIMEOUT_MS);
    } catch (err) {
      console.warn(`[fallback] AIML (${this.model}) exhausted/failed: ${(err as Error)?.message ?? err}; routing this call to Vertex Gemini (still billed as ${this.model}).`);
      return await this.fallback.complete(req);
    }
  }
  async generateImage(req: ImageRequest): Promise<ImageResult> {
    try {
      const primary = this.primary.generateImage?.(req);
      if (!primary) throw new Error('primary has no image endpoint');
      return (await withTimeout(primary, AIML_IMAGE_TIMEOUT_MS)) ?? {};
    } catch (err) {
      console.warn(`[fallback] AIML image (${this.model}) failed: ${(err as Error)?.message ?? err}; routing to Vertex (still billed as ${this.model}).`);
      return (await this.fallback.generateImage?.(req)) ?? {};
    }
  }
}

// AIML is the default/main path; 'dev' routes to Bedrock/Vertex/Featherless to save AIML credit.
// Every client is wrapped in meter() so all real calls accrue into the spend tracker.
export function modelFor(role: AgentRole, mode: ModelMode = activeMode()): ModelClient {
  const entry = ROUTES[role];
  if (mode === 'aiml') {
    const apiKey = process.env.AIML_API_KEY;
    if (apiKey) {
      const primary = new AimlModelClient({ apiKey, model: entry.aiml });
      const fallback = new GeminiModelClient({ model: entry.devProvider === 'gemini' ? entry.devModel : 'gemini-2.5-flash' });
      return meter(new FallbackModelClient(primary, fallback));
    }
    // AIML is the wired/preferred provider, but until the key is set we fall back to
    // the current dev models (Vertex/Bedrock/Featherless) so everything keeps running.
    // The moment AIML_API_KEY is set, every agent routes through AIML automatically.
    mode = 'dev';
  }
  // Vertex-only mode: route EVERY agent through Gemini on Vertex, so the whole
  // multi-agent flow runs on a single GCP credential (no AIML key, no AWS/Bedrock).
  // Honors the gemini devModel where one is set (e.g. EU on gemini-2.5-pro) and
  // falls back to flash elsewhere, keeping a little model variety.
  if (mode === 'vertex') {
    const gm = entry.devProvider === 'gemini' ? entry.devModel : 'gemini-2.5-flash';
    return meter(new GeminiModelClient({ model: gm }));
  }
  if (entry.devProvider === 'bedrock') return meter(new BedrockModelClient({ model: entry.devModel }));
  if (entry.devProvider === 'featherless') {
    const key = process.env.FEATHERLESS_API_KEY;
    if (key) return meter(new FeatherlessModelClient({ apiKey: key, model: process.env.FEATHERLESS_MODEL ?? entry.devModel }));
    console.warn(`[route] FEATHERLESS_API_KEY not set; ${role} falling back to Bedrock claude-sonnet-4-6.`);
    return meter(new BedrockModelClient({ model: 'us.anthropic.claude-sonnet-4-6' }));
  }
  return meter(new GeminiModelClient({ model: entry.devModel }));
}

// Nano Banana image generation: AIML is the main path; Vertex Gemini is the dev cost-saver.
export function imageClientFor(mode: ModelMode = activeMode()): ModelClient {
  if (mode === 'aiml') {
    const apiKey = process.env.AIML_API_KEY;
    if (apiKey) return meter(new FallbackModelClient(new AimlModelClient({ apiKey, model: IMAGE_AIML_MODEL, imageModel: IMAGE_AIML_MODEL }), new GeminiModelClient({ model: 'gemini-2.5-flash' })));
    // No AIML key yet: fall back to Vertex Gemini image gen (the dev path).
  }
  return meter(new GeminiModelClient({ model: 'gemini-2.5-flash' }));
}

// The vision model for the perception pre-pass: it "sees" each material's frames
// once and emits a text description/OCR/claims that cascade to every reviewer.
// AIML is the default (a vision-capable chat model via image_url parts); dev mode
// uses Gemini (also vision-capable). On the AIML route with no AIML key we still
// fall back to Gemini when it is reachable (Vertex service account on Cloud Run, or
// a Gemini API key), so the hosted key-free app still "sees". Returns undefined
// ONLY when no provider is reachable, so perception degrades to text-only instead
// of throwing.
export function visionModelFor(mode: ModelMode = activeMode()): ModelClient | undefined {
  if (mode === 'aiml') {
    const apiKey = process.env.AIML_API_KEY;
    if (apiKey) {
      // Wrap the AIML vision model in the same timeout-fallback as the reviewers: a
      // hanging AIML vision call would otherwise stall the whole review at the
      // perception pre-pass (before any event fires) on a fresh image material.
      const primary = new AimlModelClient({ apiKey, model: PERCEPTION_VISION_AIML() });
      return geminiReachable() ? new FallbackModelClient(primary, new GeminiModelClient({ model: PERCEPTION_VISION_DEV })) : primary;
    }
    if (geminiReachable()) return new GeminiModelClient({ model: PERCEPTION_VISION_DEV });
    return undefined;
  }
  return new GeminiModelClient({ model: PERCEPTION_VISION_DEV });
}

// The speech-to-text client for the perception pre-pass (Whisper-class). AIML is
// the preferred transcription endpoint (a real Whisper model), so it is used in
// BOTH modes whenever an AIML key exists. In dev mode with no AIML key we fall
// back to Gemini, which can transcribe audio via an inlineData part (Bedrock has
// no Whisper endpoint): this keeps a dev run transcribing with only GCP/Gemini
// auth. In aiml mode with no key there is no STT, so it returns undefined and STT
// degrades to a pasted transcript (or none) rather than throwing. This mirrors
// modelFor's graceful provider fallback: the route is described as AIML, the
// runtime simply degrades to the next reachable provider.
export function sttClientFor(mode: ModelMode = activeMode()): SttClient | undefined {
  const apiKey = process.env.AIML_API_KEY;
  if (apiKey) return new AimlSttClient({ apiKey, model: PERCEPTION_STT_AIML() });
  // No AIML key: Gemini transcribes (audio inlineData) whenever it is reachable,
  // i.e. dev mode, or Vertex is configured (service account on Cloud Run / ADC
  // locally), or a Gemini API key exists. This makes a key-free Cloud Run run on a
  // Vertex service account still transcribe uploaded videos. Only when no provider
  // is reachable do we return undefined and STT degrades to a pasted transcript (or
  // none) rather than throwing.
  if (mode === 'dev' || geminiReachable()) return new GeminiSttClient({ model: PERCEPTION_STT_DEV() });
  return undefined;
}

// Both perception models in one call, each optional (absent when unreachable) so
// the perception pass can run with whatever modalities are available.
export function perceptionModels(mode: ModelMode = activeMode()): {
  vision?: ModelClient;
  stt?: SttClient;
} {
  const out: { vision?: ModelClient; stt?: SttClient } = {};
  const vision = visionModelFor(mode);
  if (vision) out.vision = vision;
  const stt = sttClientFor(mode);
  if (stt) out.stt = stt;
  return out;
}

/** Role -> model map for the active mode, with no clients constructed (for logging/docs). */
export function describeRoutes(mode: ModelMode = activeMode()): Record<AgentRole, string> {
  const out = {} as Record<AgentRole, string>;
  for (const role of Object.keys(ROUTES) as AgentRole[]) {
    const e = ROUTES[role];
    out[role] =
      mode === 'aiml'
        ? `aiml:${e.aiml}`
        : mode === 'vertex'
          ? `vertex:${e.devProvider === 'gemini' ? e.devModel : 'gemini-2.5-flash'}`
          : `${e.devProvider}:${e.devModel}`;
  }
  return out;
}

/** Perception (vision + STT) routing for the active mode, for logging/docs. */
export function describePerception(mode: ModelMode = activeMode()): Record<PerceptionRole, string> {
  return mode === 'aiml'
    ? {
        'perception-vision': `aiml:${PERCEPTION_VISION_AIML()}`,
        'perception-stt': `aiml:${PERCEPTION_STT_AIML()}`,
      }
    : {
        'perception-vision': `gemini:${PERCEPTION_VISION_DEV}`,
        'perception-stt': `aiml:${PERCEPTION_STT_AIML()}`,
      };
}
