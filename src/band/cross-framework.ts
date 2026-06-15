// Cross-framework reviewer. Every other agent in the room runs on the band.ai
// GenericAdapter (our onMessage handler). This builds ONE reviewer on a DIFFERENT
// agent framework: the SDK's OpenAI tool-calling adapter, which runs its own
// tool-calling loop and calls the room tools itself. So the room visibly spans
// frameworks, not just models, with no extra dependency (it uses the already
// installed `openai` client, pointed at the AIML endpoint). Adapters only run on
// the live transport, so this is exercised live; here it is constructed and the
// AIML routing is unit-tested.

import OpenAI from 'openai';
import { OpenAIAdapter, type OpenAIClientFactory } from '@band-ai/sdk/adapters';

/** The AIML OpenAI-compatible gateway, the project's main model path. */
export const AIML_BASE_URL = 'https://api.aimlapi.com/v1';

/**
 * An OpenAI client factory pinned to the AIML endpoint. The SDK's default factory
 * passes only an api key (no base URL), so a custom factory is required to route
 * the framework agent through AIML rather than api.openai.com. The installed
 * `openai` client structurally satisfies the SDK's OpenAIClientLike shape.
 */
export function aimlClientFactory(apiKey: string, baseURL: string = AIML_BASE_URL): OpenAIClientFactory {
  return async (input) =>
    new OpenAI({ apiKey: input.apiKey ?? apiKey, baseURL }) as unknown as Awaited<ReturnType<OpenAIClientFactory>>;
}

export interface CrossFrameworkReviewerOptions {
  /** AIML api key, forwarded to the OpenAI-compatible client. */
  apiKey: string;
  /** AIML model slug for this reviewer (defaults to the US reviewer's GPT slug). */
  model?: string;
  /** Override the AIML base URL (tests, alternate gateways). */
  baseURL?: string;
  /** The reviewer's mandate, steering the tool-calling loop. */
  systemPrompt: string;
}

/**
 * Build a cross-framework reviewer adapter: a band.ai OpenAI tool-calling adapter
 * (a FrameworkAdapter, so Agent.create accepts it in place of GenericAdapter)
 * routed through AIML. The model drives the room tools (sendEvent to narrate,
 * sendMessage to report and @mention reconcile) per the system prompt.
 */
export function buildCrossFrameworkAdapter(opts: CrossFrameworkReviewerOptions): OpenAIAdapter {
  return new OpenAIAdapter({
    openAIModel: opts.model ?? 'openai/gpt-5-2',
    apiKey: opts.apiKey,
    clientFactory: aimlClientFactory(opts.apiKey, opts.baseURL),
    systemPrompt: opts.systemPrompt,
    enableExecutionReporting: true,
  });
}

/** Mandate for a cross-framework brand-voice reviewer that coordinates in the room. */
export const CROSS_FRAMEWORK_BRAND_PROMPT = [
  'You are the Brand Voice reviewer on a multi-region marketing-compliance board, running on the OpenAI tool-calling framework (a different agent framework than the other reviewers).',
  'Read the campaign in the room and judge it on brand voice: keep it bold and on-brand, and flag any forbidden or off-voice phrasing.',
  'First call the send-event tool to narrate a brief thought, then call the send-message tool to report ONE concise brand-voice finding and @mention the reconcile agent (its handle contains "reconcile").',
].join(' ');
