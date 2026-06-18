// Synthesized perception for text-on-screen videos.
//
// Most short-form videos carry their message as on-screen text, not a voiceover,
// so STT yields nothing. synthesizeVideoPerception fills a coherent perception
// from the authored fields + frames WITHOUT a model. These tests pin: it is
// deterministic, total (handles garbage/empty copy), grounds claims in the
// authored claim/copy, and never overwrites a value already present (prior wins).

import { describe, expect, it } from 'vitest';
import { synthesizeVideoPerception } from '../src/perception/synthesize';
import { transcribeVideoMaterial } from '../src/perception/transcribe';
import { Material } from '../src/domain/types';

function video(extra: Record<string, unknown> = {}) {
  return Material.parse({
    id: 'demo',
    name: 'Immune+ Demo',
    kind: 'video',
    channel: 'instagram',
    markets: ['US', 'EU', 'LATAM'],
    copy: 'Feel your best every day. Immune+ supports your daily immune response.',
    claim: 'supports daily immune response',
    videoUrl: '/api/videos/demo.mp4',
    ...extra,
  });
}

describe('synthesizeVideoPerception', () => {
  it('fills every perception field from the authored content', () => {
    const p = synthesizeVideoPerception(video(), ['/api/images/f1.jpg', '/api/images/f2.jpg']);
    expect(p.transcript && p.transcript.length).toBeTruthy();
    expect(p.onScreenText && p.onScreenText.length).toBeTruthy();
    expect(p.visualDescription && p.visualDescription.length).toBeTruthy();
    expect(p.detectedClaims && p.detectedClaims.length).toBeGreaterThan(0);
    expect(p.frames).toEqual(['/api/images/f1.jpg', '/api/images/f2.jpg']);
  });

  it('grounds detected claims in the authored claim', () => {
    const p = synthesizeVideoPerception(video());
    expect(p.detectedClaims).toContain('supports daily immune response');
  });

  it('is deterministic (same input -> same output)', () => {
    const a = synthesizeVideoPerception(video(), ['/x.jpg']);
    const b = synthesizeVideoPerception(video(), ['/x.jpg']);
    expect(a).toEqual(b);
  });

  it('is total: garbage/short copy still yields a well-formed result', () => {
    const p = synthesizeVideoPerception(video({ copy: 'ads', claim: 'asd' }));
    expect(p.detectedClaims && p.detectedClaims.length).toBeGreaterThan(0);
    expect(p.transcript && p.transcript.length).toBeTruthy();
    expect(p.visualDescription && p.visualDescription.length).toBeTruthy();
  });

  it('never overwrites a value already present (prior wins)', () => {
    const prior = { frames: ['/seed.jpg'], transcript: 'real spoken transcript' };
    const p = synthesizeVideoPerception(video(), [], prior);
    expect(p.transcript).toBe('real spoken transcript');
    expect(p.frames).toEqual(['/seed.jpg']);
  });
});

describe('transcribeVideoMaterial text-on-screen fallback', () => {
  it('synthesizes a perception when there is no audio transcript (no STT, no local file)', async () => {
    // No resolveVideoPath -> no local file -> STT cannot run; the text-first
    // fallback must still produce a coherent perception.
    const p = await transcribeVideoMaterial(video());
    expect(p.transcript && p.transcript.length).toBeTruthy();
    expect(p.detectedClaims && p.detectedClaims.length).toBeGreaterThan(0);
    expect(p.onScreenText && p.onScreenText.length).toBeTruthy();
  });

  it('keeps a real prior transcript instead of synthesizing over it', async () => {
    const m = video({ perception: { frames: [], transcript: 'spoken voiceover here' } });
    const p = await transcribeVideoMaterial(m);
    expect(p.transcript).toBe('spoken voiceover here');
  });
});
