import { describe, expect, it } from 'vitest';
import { priceFor, SpendTracker } from '../src/models/spend';

describe('priceFor', () => {
  it('matches model slugs to the right pricing tier (case-insensitive, ordered)', () => {
    expect(priceFor('us.anthropic.claude-opus-4-6-v1')).toEqual({ inputPer1M: 15, outputPer1M: 75 });
    expect(priceFor('us.anthropic.claude-sonnet-4-6')).toEqual({ inputPer1M: 3, outputPer1M: 15 });
    expect(priceFor('anthropic/claude-haiku-4.5')).toEqual({ inputPer1M: 0.8, outputPer1M: 4 });
    expect(priceFor('openai/gpt-5-2')).toEqual({ inputPer1M: 1.25, outputPer1M: 10 });
    expect(priceFor('google/gemini-2.5-pro')).toEqual({ inputPer1M: 1.25, outputPer1M: 10 });
    expect(priceFor('google/gemini-2.5-flash')).toEqual({ inputPer1M: 0.3, outputPer1M: 2.5 });
    expect(priceFor('deepseek/deepseek-chat')).toEqual({ inputPer1M: 0.27, outputPer1M: 1.1 });
    expect(priceFor('meta-llama/llama-3.1-8b-instruct')).toEqual({ inputPer1M: 0.1, outputPer1M: 0.1 });
  });

  it("checks 'image' first and falls back to {1,3} for unknown models", () => {
    expect(priceFor('google/gemini-2.5-flash-image')).toEqual({ inputPer1M: 0, outputPer1M: 0, perImage: 0.039 });
    expect(priceFor('some/unknown-model')).toEqual({ inputPer1M: 1, outputPer1M: 3 });
  });
});

describe('SpendTracker', () => {
  it('accumulates usd and per-model token counts from record()', () => {
    const t = new SpendTracker();
    t.record('us.anthropic.claude-sonnet-4-6', { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    const snap = t.snapshot();
    expect(snap.totalUsd).toBeCloseTo(18, 10);
    expect(snap.calls).toBe(1);
    expect(snap.byModel).toHaveLength(1);
    expect(snap.byModel[0]).toEqual({
      model: 'us.anthropic.claude-sonnet-4-6',
      calls: 1,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      images: 0,
      usd: snap.byModel[0]!.usd,
    });
    expect(snap.byModel[0]!.usd).toBeCloseTo(18, 10);
  });

  it('aggregates repeated calls to the same model and totals across models', () => {
    const t = new SpendTracker();
    t.record('us.anthropic.claude-sonnet-4-6', { inputTokens: 1_000_000, outputTokens: 0 }); // 3
    t.record('us.anthropic.claude-sonnet-4-6', { inputTokens: 0, outputTokens: 1_000_000 }); // 15
    t.record('openai/gpt-5-2', { inputTokens: 1_000_000, outputTokens: 0 }); // 1.25
    const snap = t.snapshot();
    expect(snap.calls).toBe(3);
    expect(snap.totalUsd).toBeCloseTo(19.25, 10);
    // sorted by usd desc: sonnet (18) before gpt-5 (1.25)
    expect(snap.byModel.map((m) => m.model)).toEqual(['us.anthropic.claude-sonnet-4-6', 'openai/gpt-5-2']);
    const sonnet = snap.byModel[0]!;
    expect(sonnet.calls).toBe(2);
    expect(sonnet.inputTokens).toBe(1_000_000);
    expect(sonnet.outputTokens).toBe(1_000_000);
    expect(sonnet.usd).toBeCloseTo(18, 10);
  });

  it('recordImage adds the per-image price and counts an image', () => {
    const t = new SpendTracker();
    t.recordImage('google/gemini-2.5-flash-image');
    t.recordImage('google/gemini-2.5-flash-image');
    const snap = t.snapshot();
    expect(snap.calls).toBe(2);
    expect(snap.totalUsd).toBeCloseTo(0.078, 10);
    expect(snap.byModel[0]!.images).toBe(2);
    expect(snap.byModel[0]!.usd).toBeCloseTo(0.078, 10);
  });

  it('reset clears all accumulated spend', () => {
    const t = new SpendTracker();
    t.record('openai/gpt-5-2', { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    t.reset();
    const snap = t.snapshot();
    expect(snap.totalUsd).toBe(0);
    expect(snap.calls).toBe(0);
    expect(snap.byModel).toHaveLength(0);
  });
});
