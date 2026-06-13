import type { ModelClient } from './client';
import { AimlModelClient } from './aiml';
import { BedrockModelClient } from './bedrock';
import { GeminiModelClient } from './gemini';

export type AgentRole = 'coordinator' | 'us' | 'eu' | 'latam' | 'brand' | 'reconcile' | 'remediation';
export type ModelMode = 'aiml' | 'dev';

interface RouteEntry {
  aiml: string;
  devProvider: 'bedrock' | 'gemini';
  devModel: string;
}

// Each agent runs a different model (multi-model by design). AIML slugs are the
// main path; dev models mirror what the sibling `noelle` project uses (no Opus 4.8).
const ROUTES: Record<AgentRole, RouteEntry> = {
  coordinator: { aiml: 'google/gemini-2.5-flash', devProvider: 'gemini', devModel: 'gemini-2.5-flash' },
  us: { aiml: 'anthropic/claude-sonnet-4.5', devProvider: 'bedrock', devModel: 'us.anthropic.claude-sonnet-4-6' },
  eu: { aiml: 'google/gemini-2.5-pro', devProvider: 'gemini', devModel: 'gemini-2.5-pro' },
  latam: { aiml: 'anthropic/claude-sonnet-4.5', devProvider: 'bedrock', devModel: 'us.anthropic.claude-sonnet-4-6' },
  brand: { aiml: 'anthropic/claude-haiku-4.5', devProvider: 'bedrock', devModel: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' },
  reconcile: { aiml: 'anthropic/claude-opus-4-5', devProvider: 'bedrock', devModel: 'us.anthropic.claude-opus-4-6-v1' },
  remediation: { aiml: 'anthropic/claude-sonnet-4.5', devProvider: 'bedrock', devModel: 'us.anthropic.claude-sonnet-4-6' },
};

const IMAGE_AIML_MODEL = 'google/gemini-2.5-flash-image';

export function activeMode(): ModelMode {
  return process.env.MODEL_MODE === 'dev' ? 'dev' : 'aiml';
}

// AIML is the default/main path; 'dev' routes to Bedrock/Vertex to save AIML credit.
export function modelFor(role: AgentRole, mode: ModelMode = activeMode()): ModelClient {
  const entry = ROUTES[role];
  if (mode === 'aiml') {
    const apiKey = process.env.AIML_API_KEY;
    if (!apiKey) throw new Error('AIML_API_KEY is not set but MODEL_MODE=aiml.');
    return new AimlModelClient({ apiKey, model: entry.aiml });
  }
  if (entry.devProvider === 'bedrock') return new BedrockModelClient({ model: entry.devModel });
  return new GeminiModelClient({ model: entry.devModel });
}

// Nano Banana image generation: AIML is the main path; Vertex Gemini is the dev cost-saver.
export function imageClientFor(mode: ModelMode = activeMode()): ModelClient {
  if (mode === 'aiml') {
    const apiKey = process.env.AIML_API_KEY;
    if (!apiKey) throw new Error('AIML_API_KEY is not set but MODEL_MODE=aiml.');
    return new AimlModelClient({ apiKey, model: IMAGE_AIML_MODEL });
  }
  return new GeminiModelClient({ model: 'gemini-2.5-flash' });
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
