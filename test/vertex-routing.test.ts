import { describe, it, expect } from 'vitest';
import { describeRoutes } from '../src/models/route';

// MODEL_MODE=vertex must route EVERY agent through Gemini on Vertex, so the whole
// multi-agent flow runs on a single GCP credential, with no AIML key and no
// AWS/Bedrock. This guards against an agent silently falling back to a provider
// the operator has no credentials for (which would stall a live review).
describe('vertex model mode routing', () => {
  it('routes every agent to Gemini on Vertex', () => {
    const routes = describeRoutes('vertex');
    const values = Object.values(routes);
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) expect(v.startsWith('vertex:gemini')).toBe(true);
  });

  it('uses no provider that needs AIML or AWS credentials', () => {
    const values = Object.values(describeRoutes('vertex'));
    expect(values.some((v) => v.includes('bedrock') || v.includes('aiml') || v.includes('featherless'))).toBe(false);
  });
});
