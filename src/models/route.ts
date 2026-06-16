import type { ModelClient, SttClient } from './client';
import { AimlModelClient, AimlSttClient, DEFAULT_STT_MODEL } from './aiml';
import { BedrockModelClient } from './bedrock';
import { GeminiModelClient } from './gemini';
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
export type ModelMode = 'aiml' | 'dev';

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
  coordinator: { aiml: 'google/gemini-2.5-flash', devProvider: 'gemini', devModel: 'gemini-2.5-flash' },
  us: { aiml: 'openai/gpt-5-2', devProvider: 'bedrock', devModel: 'us.anthropic.claude-sonnet-4-6' },
  eu: { aiml: 'google/gemini-2.5-pro', devProvider: 'gemini', devModel: 'gemini-2.5-pro' },
  latam: { aiml: 'meta-llama/llama-3.1-8b-instruct', devProvider: 'featherless', devModel: 'meta-llama/Meta-Llama-3.1-8B-Instruct' },
  brand: { aiml: 'anthropic/claude-haiku-4.5', devProvider: 'bedrock', devModel: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' },
  reconcile: { aiml: 'anthropic/claude-opus-4-5', devProvider: 'bedrock', devModel: 'us.anthropic.claude-opus-4-6-v1' },
  remediation: { aiml: 'deepseek/deepseek-chat', devProvider: 'bedrock', devModel: 'us.anthropic.claude-sonnet-4-6' },
  scout: { aiml: 'meta-llama/llama-3.1-8b-instruct', devProvider: 'featherless', devModel: 'meta-llama/Meta-Llama-3.1-8B-Instruct' },
  claim: { aiml: 'google/gemini-2.5-pro', devProvider: 'gemini', devModel: 'gemini-2.5-pro' },
  precedent: { aiml: 'google/gemini-2.5-flash', devProvider: 'gemini', devModel: 'gemini-2.5-flash' },
  disclosure: { aiml: 'anthropic/claude-sonnet-4.5', devProvider: 'bedrock', devModel: 'us.anthropic.claude-sonnet-4-6' },
  channel: { aiml: 'google/gemini-2.5-flash', devProvider: 'gemini', devModel: 'gemini-2.5-flash' },
  visual: { aiml: 'google/gemini-2.5-flash', devProvider: 'gemini', devModel: 'gemini-2.5-flash' },
  mediator: { aiml: 'anthropic/claude-opus-4-5', devProvider: 'bedrock', devModel: 'us.anthropic.claude-opus-4-6-v1' },
};

const IMAGE_AIML_MODEL = 'google/gemini-2.5-flash-image';

// Perception model defaults (AIML, the three-modalities path). Both are
// env-overridable so the exact AIML catalog slug can be swapped without a code
// change. AIML_VISION_MODEL is a vision-capable chat model (image_url parts);
// AIML_STT_MODEL is a Whisper-class transcription model.
const PERCEPTION_VISION_AIML = () => process.env.AIML_VISION_MODEL ?? 'openai/gpt-5-2';
const PERCEPTION_STT_AIML = () => process.env.AIML_STT_MODEL ?? DEFAULT_STT_MODEL;
// dev-mode (cost-saver) perception models: Gemini sees, Whisper-on-AIML still
// hears (Bedrock has no Whisper endpoint, so STT stays on AIML when a key exists).
const PERCEPTION_VISION_DEV = 'gemini-2.5-flash';

export function activeMode(): ModelMode {
  return process.env.MODEL_MODE === 'dev' ? 'dev' : 'aiml';
}

// AIML is the default/main path; 'dev' routes to Bedrock/Vertex/Featherless to save AIML credit.
// Every client is wrapped in meter() so all real calls accrue into the spend tracker.
export function modelFor(role: AgentRole, mode: ModelMode = activeMode()): ModelClient {
  const entry = ROUTES[role];
  if (mode === 'aiml') {
    const apiKey = process.env.AIML_API_KEY;
    if (!apiKey) throw new Error('AIML_API_KEY is not set but MODEL_MODE=aiml.');
    return meter(new AimlModelClient({ apiKey, model: entry.aiml }));
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
    if (!apiKey) throw new Error('AIML_API_KEY is not set but MODEL_MODE=aiml.');
    return meter(new AimlModelClient({ apiKey, model: IMAGE_AIML_MODEL }));
  }
  return meter(new GeminiModelClient({ model: 'gemini-2.5-flash' }));
}

// The vision model for the perception pre-pass: it "sees" each material's frames
// once and emits a text description/OCR/claims that cascade to every reviewer.
// AIML is the default (a vision-capable chat model via image_url parts); dev mode
// uses Gemini (also vision-capable). Returns undefined ONLY when no provider is
// reachable, so perception degrades to text-only instead of throwing.
export function visionModelFor(mode: ModelMode = activeMode()): ModelClient | undefined {
  if (mode === 'aiml') {
    const apiKey = process.env.AIML_API_KEY;
    if (!apiKey) return undefined;
    return new AimlModelClient({ apiKey, model: PERCEPTION_VISION_AIML() });
  }
  return new GeminiModelClient({ model: PERCEPTION_VISION_DEV });
}

// The speech-to-text client for the perception pre-pass (Whisper-class). AIML is
// the only transcription endpoint here, so even dev mode uses AIML when a key
// exists; returns undefined when none is set so STT degrades to a pasted
// transcript (or none) rather than throwing.
export function sttClientFor(_mode: ModelMode = activeMode()): SttClient | undefined {
  const apiKey = process.env.AIML_API_KEY;
  if (!apiKey) return undefined;
  return new AimlSttClient({ apiKey, model: PERCEPTION_STT_AIML() });
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
    out[role] = mode === 'aiml' ? `aiml:${e.aiml}` : `${e.devProvider}:${e.devModel}`;
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
