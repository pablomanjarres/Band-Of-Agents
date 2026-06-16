import { describe, expect, it, afterEach } from 'vitest';
import { describeRoutes, describePerception, sttClientFor } from '../src/models/route';
import { AimlSttClient } from '../src/models/aiml';
import { GeminiSttClient } from '../src/models/gemini';

describe('model routing', () => {
  it('routes every role through AIML and spans diverse model families in aiml mode', () => {
    const r = describeRoutes('aiml');
    expect(Object.values(r).every((v) => v.startsWith('aiml:'))).toBe(true);
    const families = new Set(Object.values(r).map((v) => v.replace('aiml:', '').split('/')[0] ?? ''));
    expect(families.size).toBeGreaterThanOrEqual(4);
  });

  it('uses Noelle-aligned provider models in dev mode (no Opus 4.8)', () => {
    const r = describeRoutes('dev');
    expect(r.us).toBe('bedrock:us.anthropic.claude-sonnet-4-6');
    expect(r.reconcile).toBe('bedrock:us.anthropic.claude-opus-4-6-v1');
    expect(r.brand).toBe('bedrock:us.anthropic.claude-haiku-4-5-20251001-v1:0');
    expect(r.eu).toBe('gemini:gemini-2.5-pro');
    expect(r.latam).toBe('featherless:meta-llama/Meta-Llama-3.1-8B-Instruct');
  });

  it('routes every new pod/board role', () => {
    const r = describeRoutes('dev');
    for (const role of ['scout', 'claim', 'precedent', 'disclosure', 'channel', 'visual', 'mediator']) {
      expect(r[role as keyof typeof r]).toBeTruthy();
    }
    expect(r.scout).toContain('featherless:');
    expect(r.mediator).toContain('bedrock:');
  });
});

describe('perception routing (vision + STT)', () => {
  const saved = { v: process.env.AIML_VISION_MODEL, s: process.env.AIML_STT_MODEL };
  afterEach(() => {
    if (saved.v === undefined) delete process.env.AIML_VISION_MODEL;
    else process.env.AIML_VISION_MODEL = saved.v;
    if (saved.s === undefined) delete process.env.AIML_STT_MODEL;
    else process.env.AIML_STT_MODEL = saved.s;
  });

  it('defaults both perception roles to AIML', () => {
    delete process.env.AIML_VISION_MODEL;
    delete process.env.AIML_STT_MODEL;
    const p = describePerception('aiml');
    expect(p['perception-vision'].startsWith('aiml:')).toBe(true);
    expect(p['perception-stt'].startsWith('aiml:')).toBe(true);
  });

  it('honors the env-overridable slugs', () => {
    process.env.AIML_VISION_MODEL = 'vendor/custom-vision';
    process.env.AIML_STT_MODEL = 'vendor/custom-whisper';
    const p = describePerception('aiml');
    expect(p['perception-vision']).toBe('aiml:vendor/custom-vision');
    expect(p['perception-stt']).toBe('aiml:vendor/custom-whisper');
  });

  it('keeps STT on AIML even in dev mode (no Bedrock Whisper)', () => {
    const p = describePerception('dev');
    expect(p['perception-vision'].startsWith('gemini:')).toBe(true);
    expect(p['perception-stt'].startsWith('aiml:')).toBe(true);
  });
});


describe('sttClientFor: a dev-mode STT exists even with no AIML key', () => {
  const saved = { key: process.env.AIML_API_KEY, vertex: process.env.GOOGLE_GENAI_USE_VERTEXAI };
  afterEach(() => {
    if (saved.key === undefined) delete process.env.AIML_API_KEY;
    else process.env.AIML_API_KEY = saved.key;
    if (saved.vertex === undefined) delete process.env.GOOGLE_GENAI_USE_VERTEXAI;
    else process.env.GOOGLE_GENAI_USE_VERTEXAI = saved.vertex;
  });

  it('dev mode with no AIML key returns a Gemini-backed STT client (not undefined)', () => {
    delete process.env.AIML_API_KEY;
    delete process.env.GOOGLE_GENAI_USE_VERTEXAI;
    const client = sttClientFor('dev');
    expect(client).toBeInstanceOf(GeminiSttClient);
    expect(client?.model).toBeTruthy();
  });

  it('aiml mode with no AIML key returns undefined (STT degrades to a pasted transcript)', () => {
    delete process.env.AIML_API_KEY;
    expect(sttClientFor('aiml')).toBeUndefined();
  });

  it('an AIML key makes BOTH modes prefer the AIML Whisper client', () => {
    process.env.AIML_API_KEY = 'test-key';
    expect(sttClientFor('aiml')).toBeInstanceOf(AimlSttClient);
    expect(sttClientFor('dev')).toBeInstanceOf(AimlSttClient);
  });
});
