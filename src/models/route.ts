import type { ModelClient } from './client';
import { AimlModelClient } from './aiml';
import { BedrockModelClient } from './bedrock';
import { GeminiModelClient } from './gemini';
import { FeatherlessModelClient } from './featherless';
import { meter } from './spend';

export type AgentRole =
  | 'coordinator' | 'us' | 'eu' | 'latam' | 'brand' | 'reconcile' | 'remediation'
  | 'scout' | 'claim' | 'precedent' | 'disclosure' | 'channel' | 'visual' | 'mediator';
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

/** Role -> model map for the active mode, with no clients constructed (for logging/docs). */
export function describeRoutes(mode: ModelMode = activeMode()): Record<AgentRole, string> {
  const out = {} as Record<AgentRole, string>;
  for (const role of Object.keys(ROUTES) as AgentRole[]) {
    const e = ROUTES[role];
    out[role] = mode === 'aiml' ? `aiml:${e.aiml}` : `${e.devProvider}:${e.devModel}`;
  }
  return out;
}
