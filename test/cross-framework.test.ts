import { describe, expect, it } from 'vitest';
import OpenAI from 'openai';
import { OpenAIAdapter } from '@band-ai/sdk/adapters';
import { AIML_BASE_URL, aimlClientFactory, buildCrossFrameworkAdapter } from '../src/band/cross-framework';

// P3.6: one reviewer in the room runs on the OpenAI tool-calling framework (a
// different agent framework than the GenericAdapter the other agents use), so the
// room visibly spans frameworks, not just models. Adapters only run on the live
// transport, so this proves construction and the AIML routing; the in-room
// coordination is the live-verification step.
describe('Cross-framework reviewer adapter (OpenAI tool-calling framework)', () => {
  it('builds a non-GenericAdapter FrameworkAdapter that Agent.create accepts', () => {
    const adapter = buildCrossFrameworkAdapter({ apiKey: 'k', systemPrompt: 'review the asset' });
    // It is a real, different framework adapter (not our GenericAdapter handler).
    expect(adapter).toBeInstanceOf(OpenAIAdapter);
    // It satisfies the FrameworkAdapter contract Agent.create requires.
    expect(typeof (adapter as unknown as { onEvent?: unknown }).onEvent).toBe('function');
  });

  it('routes the framework agent through the AIML OpenAI-compatible endpoint', async () => {
    const factory = aimlClientFactory('test-key');
    const client = await factory({ apiKey: 'test-key' });
    expect((client as unknown as { baseURL?: string }).baseURL).toBe(AIML_BASE_URL);
    expect(client).toBeInstanceOf(OpenAI);
  });
});
