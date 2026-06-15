// Rung B: smart rulebook import + presets. These tests pin the import contract:
// a json import validates directly (no model, deterministic), an md/text import
// goes through an injected (stubbed) ModelClient and yields validated Rule[], and
// the three curated presets load and validate against the Rulebook schema. None
// of this persists anything: the import endpoint returns a PROPOSAL for the user
// to confirm via the existing PUT.

import { describe, expect, it } from 'vitest';
import { importRulebook } from '../src/domain/rulebook-import';
import { loadPresets } from '../src/domain/presets';
import { StubModelClient, type CompleteRequest } from '../src/models/client';
import { Rulebook } from '../src/domain/types';

const PRESETS_DIR = new URL('../assets/presets/', import.meta.url).pathname;

describe('rulebook import: json validates directly (no model call) and returns a proposal', () => {
  it('accepts a full Rulebook object and re-tags it to the target region', async () => {
    const content = JSON.stringify({
      region: 'us', // intentionally lower / could differ; the import forces the target region
      label: 'Pasted US rulebook',
      notLegalAdvice: true,
      rules: [
        { id: 'r-1', region: 'xx', category: 'health_claim', severity: 'block', check: 'No disease claims.', requiredDisclosure: null },
        { id: 'r-2', region: 'xx', category: 'endorsement', severity: 'warn', check: 'Disclose paid endorsements.', requiredDisclosure: 'Paid-partnership disclosure' },
      ],
    });
    const rulebook = await importRulebook({ format: 'json', content, region: 'US' });
    expect(Rulebook.safeParse(rulebook).success).toBe(true);
    expect(rulebook.region).toBe('US');
    expect(rulebook.notLegalAdvice).toBe(true);
    expect(rulebook.rules).toHaveLength(2);
    // Every rule is re-tagged to the parent region (no rule/parent mismatch).
    expect(rulebook.rules.every((r) => r.region === 'US')).toBe(true);
    expect(rulebook.rules[1]?.requiredDisclosure).toBe('Paid-partnership disclosure');
  });

  it('accepts a bare Rule[] (pasted rules only) and synthesizes stable unique ids', async () => {
    const content = JSON.stringify([
      { category: 'free_offer', severity: 'warn', check: 'State all offer terms up front.' },
      { category: 'free_offer', severity: 'warn', check: 'State auto-renewal terms.' },
    ]);
    const rulebook = await importRulebook({ format: 'json', content, region: 'eu', label: 'EU pasted rules' });
    expect(Rulebook.safeParse(rulebook).success).toBe(true);
    expect(rulebook.region).toBe('EU');
    expect(rulebook.label).toBe('EU pasted rules');
    expect(rulebook.rules).toHaveLength(2);
    const ids = rulebook.rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(2); // ids are unique even with identical categories
  });

  it('rejects content that is neither valid JSON nor a Rulebook/Rule[]', async () => {
    await expect(importRulebook({ format: 'json', content: 'not json at all', region: 'US' })).rejects.toThrow();
    await expect(importRulebook({ format: 'json', content: JSON.stringify({ foo: 'bar' }), region: 'US' })).rejects.toThrow();
  });
});

describe('rulebook import: md/text via a STUBBED ModelClient returns validated Rule[]', () => {
  it('parses freeform markdown into a valid Rulebook using the injected model', async () => {
    let captured: CompleteRequest | undefined;
    // The stub stands in for the AIML model: it sees the import prompt and returns
    // loosely-shaped rules (no ids, one invalid severity) which the parser must
    // normalize into valid Rule[].
    const model = new StubModelClient((req) => {
      captured = req;
      return {
        text: '',
        json: {
          rules: [
            { category: 'health_claim', severity: 'block', check: 'Do not claim to cure disease.' },
            { category: 'endorsement', severity: 'not-a-severity', check: 'Disclose paid endorsements.', requiredDisclosure: 'Paid-partnership disclosure' },
            { category: 'free_offer', severity: 'info', check: 'State the offer terms clearly.' },
          ],
        },
      };
    });

    const md = '# LATAM rules\n- Supplements may not claim to cure disease.\n- Paid endorsements must be disclosed.\n- Free offers must state their terms.';
    const rulebook = await importRulebook({ format: 'md', content: md, region: 'LATAM', model });

    // The model was asked for structured output (the same path the reviewers use).
    expect(captured?.jsonSchema).toBeDefined();
    expect(typeof captured?.system).toBe('string');
    expect(captured?.messages[0]?.content).toContain('LATAM rules');

    expect(Rulebook.safeParse(rulebook).success).toBe(true);
    expect(rulebook.region).toBe('LATAM');
    expect(rulebook.notLegalAdvice).toBe(true);
    expect(rulebook.rules).toHaveLength(3);
    // The bogus severity was coerced to a valid enum value (defaults to 'warn').
    expect(rulebook.rules.every((r) => ['block', 'warn', 'info'].includes(r.severity))).toBe(true);
    expect(rulebook.rules[1]?.severity).toBe('warn');
    // Ids were synthesized and tagged to the region.
    expect(rulebook.rules.every((r) => r.id.length > 0 && r.region === 'LATAM')).toBe(true);
    expect(rulebook.rules[1]?.requiredDisclosure).toBe('Paid-partnership disclosure');
  });

  it("treats plain text ('text' format) the same way, via the stubbed model", async () => {
    const model = new StubModelClient(() => ({
      text: JSON.stringify({ rules: [{ category: 'misleading', severity: 'warn', check: 'Do not omit material information.' }] }),
      // No json field: the parser falls back to parsing res.text, exercising that path.
    }));
    const rulebook = await importRulebook({ format: 'text', content: 'Do not mislead consumers by omission.', region: 'EU', model });
    expect(Rulebook.safeParse(rulebook).success).toBe(true);
    expect(rulebook.rules).toHaveLength(1);
    expect(rulebook.rules[0]?.category).toBe('misleading');
  });

  it('requires a model for md/text and surfaces an empty extraction as an error', async () => {
    await expect(importRulebook({ format: 'md', content: 'x', region: 'US' })).rejects.toThrow(/model is required/i);
    const emptyModel = new StubModelClient(() => ({ text: '', json: { rules: [] } }));
    await expect(importRulebook({ format: 'md', content: 'x', region: 'US', model: emptyModel })).rejects.toThrow(/No rules/i);
  });
});

describe('rulebook presets: the curated presets load and each validates', () => {
  it('returns the three presets (US-FTC, EU health, LATAM), each a valid Rulebook', () => {
    const presets = loadPresets(PRESETS_DIR);
    const ids = presets.map((p) => p.id).sort();
    expect(ids).toEqual(['eu-health', 'latam', 'us-ftc']);
    for (const preset of presets) {
      expect(Rulebook.safeParse(preset.rulebook).success).toBe(true);
      expect(preset.rulebook.notLegalAdvice).toBe(true);
      expect(preset.rulebook.rules.length).toBeGreaterThan(0);
      // The advertised region matches the rulebook it carries.
      expect(preset.region).toBe(preset.rulebook.region);
      expect(preset.label.length).toBeGreaterThan(0);
    }
  });

  it('maps each preset to its expected region', () => {
    const byId = new Map(loadPresets(PRESETS_DIR).map((p) => [p.id, p]));
    expect(byId.get('us-ftc')?.region).toBe('US');
    expect(byId.get('eu-health')?.region).toBe('EU');
    expect(byId.get('latam')?.region).toBe('LATAM');
  });

  it('returns an empty list for a directory with no presets (no crash)', () => {
    expect(loadPresets('/tmp/definitely-not-a-presets-dir-xyz')).toEqual([]);
  });
});
