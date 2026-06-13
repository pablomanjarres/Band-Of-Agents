import { describe, expect, it } from 'vitest';
import { describeRoutes } from '../src/models/route';

describe('model routing', () => {
  it('routes every role through AIML in aiml mode (the main path)', () => {
    const r = describeRoutes('aiml');
    expect(r.reconcile.startsWith('aiml:anthropic/')).toBe(true);
    expect(r.us.startsWith('aiml:anthropic/')).toBe(true);
    expect(r.eu.startsWith('aiml:google/')).toBe(true);
    expect(r.coordinator.startsWith('aiml:google/')).toBe(true);
  });

  it('uses Noelle-aligned provider models in dev mode (no Opus 4.8)', () => {
    const r = describeRoutes('dev');
    expect(r.us).toBe('bedrock:us.anthropic.claude-sonnet-4-6');
    expect(r.reconcile).toBe('bedrock:us.anthropic.claude-opus-4-6-v1');
    expect(r.brand).toBe('bedrock:us.anthropic.claude-haiku-4-5-20251001-v1:0');
    expect(r.eu).toBe('gemini:gemini-2.5-pro');
  });
});
