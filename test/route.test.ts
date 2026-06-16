import { describe, expect, it, afterEach } from 'vitest';
import { describeRoutes, describePerception } from '../src/models/route';

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
