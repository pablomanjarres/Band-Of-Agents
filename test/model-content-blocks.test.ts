// Rung C seam: the model content union (string | ContentBlock[]).
//
// Two guarantees, asserted with light shape checks and spies (no real network):
//   1. A plain string produces the SAME provider payload as before the seam
//      existed (text-only calls are byte-identical: zero behavior change).
//   2. An array with one image block maps to each provider's vision format.
//
// Per adapter we assert the pure content mapper (the exact shape each provider
// receives) and, for the OpenAI-compatible adapters, we also spy the SDK call so
// the string-vs-blocks payload is proven to thread all the way through complete().

import { describe, it, expect, vi, afterEach } from 'vitest';
import OpenAI from 'openai';
import type { ContentBlock } from '../src/models/client';
import { isPlainText, hasImage, toBlocks, toText } from '../src/models/client';
import { AimlModelClient, toOpenAIContent } from '../src/models/aiml';
import { FeatherlessModelClient } from '../src/models/featherless';
import { toAnthropicContent } from '../src/models/bedrock';
import { buildGeminiContents, toGeminiParts } from '../src/models/gemini';

const IMG = 'https://example.com/frame-001.jpg';
const imageMsg: ContentBlock[] = [
  { type: 'text', text: 'Describe this frame.' },
  { type: 'image', url: IMG },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('content normalizers (shared seam helpers)', () => {
  it('classifies a string as plain text and an array as not', () => {
    expect(isPlainText('hello')).toBe(true);
    expect(isPlainText(imageMsg)).toBe(false);
  });

  it('detects image blocks only when present', () => {
    expect(hasImage('hello')).toBe(false);
    expect(hasImage([{ type: 'text', text: 'x' }])).toBe(false);
    expect(hasImage(imageMsg)).toBe(true);
  });

  it('toBlocks wraps a string into a single text block and leaves arrays as-is', () => {
    expect(toBlocks('hi')).toEqual([{ type: 'text', text: 'hi' }]);
    expect(toBlocks(imageMsg)).toBe(imageMsg);
  });

  it('toText returns a string unchanged and notes images for text-only fallback', () => {
    expect(toText('hi')).toBe('hi');
    expect(toText(imageMsg)).toBe(`Describe this frame.\n[image: ${IMG}]`);
  });
});

describe('OpenAI-compatible adapters (AIML, Featherless): toOpenAIContent', () => {
  it('passes a plain string through UNCHANGED (no array wrapping)', () => {
    const out = toOpenAIContent('plain text prompt');
    expect(out).toBe('plain text prompt');
    expect(typeof out).toBe('string');
  });

  it('maps an array to OpenAI content parts (text + image_url)', () => {
    expect(toOpenAIContent(imageMsg)).toEqual([
      { type: 'text', text: 'Describe this frame.' },
      { type: 'image_url', image_url: { url: IMG } },
    ]);
  });
});

describe('AIML adapter complete(): SDK payload (spied, no network)', () => {
  it('sends a plain-string message content exactly as before', async () => {
    const spy = vi
      .spyOn(OpenAI.Chat.Completions.prototype, 'create')
      .mockResolvedValue({ choices: [{ message: { content: 'ok' } }] } as never);
    const client = new AimlModelClient({ apiKey: 'test', model: 'gpt-x' });

    await client.complete({ messages: [{ role: 'user', content: 'hello world' }] });

    const arg = spy.mock.calls[0]![0] as { messages: Array<{ role: string; content: unknown }> };
    expect(arg.messages).toEqual([{ role: 'user', content: 'hello world' }]);
  });

  it('sends image blocks as OpenAI image_url parts', async () => {
    const spy = vi
      .spyOn(OpenAI.Chat.Completions.prototype, 'create')
      .mockResolvedValue({ choices: [{ message: { content: 'ok' } }] } as never);
    const client = new AimlModelClient({ apiKey: 'test', model: 'gpt-x' });

    await client.complete({ system: 'sys', messages: [{ role: 'user', content: imageMsg }] });

    const arg = spy.mock.calls[0]![0] as { messages: Array<{ role: string; content: unknown }> };
    expect(arg.messages).toEqual([
      { role: 'system', content: 'sys' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this frame.' },
          { type: 'image_url', image_url: { url: IMG } },
        ],
      },
    ]);
  });
});

describe('Featherless adapter complete(): SDK payload (spied, no network)', () => {
  it('reuses the OpenAI mapping: string stays a string, blocks become parts', async () => {
    const spy = vi
      .spyOn(OpenAI.Chat.Completions.prototype, 'create')
      .mockResolvedValue({ choices: [{ message: { content: 'ok' } }] } as never);
    const client = new FeatherlessModelClient({ apiKey: 'test', model: 'llama-x' });

    await client.complete({ messages: [{ role: 'user', content: 'plain' }, { role: 'user', content: imageMsg }] });

    const arg = spy.mock.calls[0]![0] as { messages: Array<{ role: string; content: unknown }> };
    expect(arg.messages).toEqual([
      { role: 'user', content: 'plain' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this frame.' },
          { type: 'image_url', image_url: { url: IMG } },
        ],
      },
    ]);
  });
});

describe('Bedrock adapter: toAnthropicContent', () => {
  it('passes a plain string through UNCHANGED (no array wrapping)', () => {
    const out = toAnthropicContent('plain text prompt');
    expect(out).toBe('plain text prompt');
    expect(typeof out).toBe('string');
  });

  it('maps an array to Anthropic content blocks (text + url image source)', () => {
    expect(toAnthropicContent(imageMsg)).toEqual([
      { type: 'text', text: 'Describe this frame.' },
      { type: 'image', source: { type: 'url', url: IMG } },
    ]);
  });
});

describe('Gemini adapter: buildGeminiContents / toGeminiParts', () => {
  it('text-only messages join into a single string EXACTLY as before', () => {
    const messages = [
      { role: 'user' as const, content: 'first part' },
      { role: 'assistant' as const, content: 'second part' },
    ];
    // The legacy behavior was: req.messages.map((m) => m.content).join('\n\n').
    expect(buildGeminiContents(messages)).toBe('first part\n\nsecond part');
    expect(typeof buildGeminiContents(messages)).toBe('string');
  });

  it('maps an image message to role-tagged parts with fileData', () => {
    const out = buildGeminiContents([{ role: 'user', content: imageMsg }]);
    expect(out).toEqual([
      {
        role: 'user',
        parts: [
          { text: 'Describe this frame.' },
          { fileData: { fileUri: IMG } },
        ],
      },
    ]);
  });

  it('toGeminiParts maps blocks: text -> {text}, image -> {fileData.fileUri}', () => {
    expect(toGeminiParts(imageMsg)).toEqual([
      { text: 'Describe this frame.' },
      { fileData: { fileUri: IMG } },
    ]);
    // A plain string still becomes a single text part.
    expect(toGeminiParts('just text')).toEqual([{ text: 'just text' }]);
  });
});
