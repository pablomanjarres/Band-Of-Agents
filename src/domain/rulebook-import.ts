// Smart rulebook import: turn a freeform rulebook (.md / plain text) or a ready
// JSON file into a validated Rulebook PROPOSAL. The caller (the server) returns
// the proposal for human confirmation and only persists it on the existing
// PUT /api/rulebooks/:region; nothing here writes to the store.
//
// json:      validate the provided content against the Rulebook (or a bare
//            Rule[]) schema directly. No model call, so a JSON import is exact
//            and deterministic.
// md / text: hand the freeform text to an injected ModelClient with a JSON
//            schema mirroring Rule[] (the same structured-output pattern the
//            region reviewer uses), then normalize the returned rules (fill ids,
//            region, severity, requiredDisclosure) and validate as a Rulebook.
//
// The ModelClient is injected so tests pass a StubModelClient (no network/keys).

import type { ModelClient } from '../models/client';
import { Rule, Rulebook, Severity } from './types';
import { z } from 'zod';

export type ImportFormat = 'md' | 'json' | 'text';

export interface ImportRulebookOptions {
  format: ImportFormat;
  /** The raw uploaded rulebook: markdown, plain text, or a JSON string. */
  content: string;
  /** Region code the rulebook is for (e.g. "US"); normalized to upper case. */
  region: string;
  /** Injected for md/text parsing; tests pass a StubModelClient. Unused for json. */
  model?: ModelClient;
  /** Human-friendly label for the proposed rulebook; defaults to the region code. */
  label?: string;
}

// JSON Schema handed to the model for structured output. Mirrors a bare Rule[]
// (without region, which we fill ourselves) so a text-only rulebook becomes
// well-formed Rule objects. Shaped like region-reviewer's REVIEW_OUTPUT_JSON_SCHEMA.
const RULES_OUTPUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rules'],
  properties: {
    rules: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'severity', 'check'],
        properties: {
          id: { type: 'string' },
          category: { type: 'string' },
          severity: { type: 'string', enum: ['block', 'warn', 'info'] },
          check: { type: 'string' },
          requiredDisclosure: { type: ['string', 'null'] },
          sourceUrl: { type: 'string' },
        },
      },
    },
  },
} as const;

// A loose shape for whatever the model returns, validated rule-by-rule afterwards.
const ModelRules = z.object({
  rules: z
    .array(
      z.object({
        id: z.string().optional(),
        category: z.string().optional(),
        severity: z.string().optional(),
        check: z.string().optional(),
        requiredDisclosure: z.string().nullable().optional(),
        sourceUrl: z.string().optional(),
      }),
    )
    .default([]),
});

/** Produce a validated Rulebook proposal from a freeform or JSON rulebook. */
export async function importRulebook(opts: ImportRulebookOptions): Promise<Rulebook> {
  const region = opts.region.trim().toUpperCase();
  if (!region) throw new Error('region is required to import a rulebook.');
  const label = opts.label?.trim() || region;

  if (opts.format === 'json') {
    return importJson(opts.content, region, label);
  }
  return importFreeform(opts, region, label);
}

/**
 * Validate a JSON rulebook directly. Accepts either a full Rulebook object or a
 * bare Rule[] (the user may paste only the rules). Region and notLegalAdvice are
 * forced to the target region/true so the saved rulebook is always well-formed.
 */
function importJson(content: string, region: string, label: string): Rulebook {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (err) {
    throw new Error(`Invalid JSON: ${(err as Error).message}`);
  }

  // A bare array is treated as Rule[]; an object is treated as a Rulebook.
  if (Array.isArray(raw)) {
    return buildRulebook(raw, region, label);
  }
  const asRulebook = Rulebook.safeParse({ ...(raw as object), region, notLegalAdvice: true });
  if (asRulebook.success) {
    // Re-tag each rule to the target region so a mismatched region in the file
    // does not produce a rulebook whose rules disagree with their parent.
    return finalize(asRulebook.data, region, deriveLabel(raw, label));
  }
  // Maybe the object has a `rules` array but other fields are off; salvage rules.
  const rulesField = (raw as { rules?: unknown }).rules;
  if (Array.isArray(rulesField)) {
    return buildRulebook(rulesField, region, deriveLabel(raw, label));
  }
  throw new Error(`JSON does not match a Rulebook or Rule[]: ${asRulebook.error.message}`);
}

/** Run the freeform text through the model and validate the resulting rules. */
async function importFreeform(opts: ImportRulebookOptions, region: string, label: string): Promise<Rulebook> {
  if (!opts.model) throw new Error(`A model is required to import a ${opts.format} rulebook.`);
  const { system, user } = buildImportPrompt(opts.content, region);
  const res = await opts.model.complete({
    system,
    messages: [{ role: 'user', content: user }],
    jsonSchema: RULES_OUTPUT_JSON_SCHEMA,
  });
  const raw = res.json ?? safeJsonParse(res.text);
  const parsed = ModelRules.safeParse(raw);
  if (!parsed.success) {
    throw new Error('The model did not return a parseable {"rules":[...]} object.');
  }
  if (parsed.data.rules.length === 0) {
    throw new Error('No rules could be extracted from the provided text.');
  }
  return buildRulebook(parsed.data.rules, region, label);
}

/** Build the import prompt: extract atomic compliance rules from freeform text. */
function buildImportPrompt(content: string, region: string): { system: string; user: string } {
  const system = [
    `You convert a freeform ${region} marketing-compliance rulebook into structured rules. This is a demo, NOT legal advice.`,
    'Read the document and emit one rule per distinct, checkable requirement. Do not invent rules that are not in the text.',
    'For each rule: a short snake_case category; a severity of "block" (hard violation that must not publish), "warn" (allowed with a disclosure or caution), or "info" (advisory); a one-sentence "check" describing what to verify; an optional requiredDisclosure (the exact disclosure text when the rule is fixable by adding one, otherwise null); and an optional sourceUrl if the text cites one.',
    'Return JSON {"rules":[{"category","severity":"block"|"warn"|"info","check","requiredDisclosure"?,"sourceUrl"?}]}.',
  ].join('\n\n');
  const user = `Region: ${region}\n\nRulebook document:\n\n${content.trim()}`;
  return { system, user };
}

/**
 * Normalize loose rule objects into valid Rule[] and wrap them in a Rulebook:
 * fill the region, default a missing severity to "warn", synthesize a stable id
 * from category/index when absent, and force requiredDisclosure to null when not
 * a string. Then parse through the real schema so the proposal is guaranteed valid.
 */
function buildRulebook(rawRules: unknown[], region: string, label: string): Rulebook {
  const seen = new Set<string>();
  const rules = rawRules.map((r, i) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const category = typeof o.category === 'string' && o.category.trim() ? o.category.trim() : 'general';
    const severity = Severity.safeParse(o.severity).success ? (o.severity as Severity) : 'warn';
    const check = typeof o.check === 'string' ? o.check.trim() : '';
    const id = uniqueId(typeof o.id === 'string' && o.id.trim() ? o.id.trim() : `${region.toLowerCase()}-${slug(category)}-${i + 1}`, seen);
    const requiredDisclosure = typeof o.requiredDisclosure === 'string' && o.requiredDisclosure.trim() ? o.requiredDisclosure.trim() : null;
    const base: Record<string, unknown> = { id, region, category, severity, check, requiredDisclosure };
    if (typeof o.sourceUrl === 'string' && o.sourceUrl.trim()) base.sourceUrl = o.sourceUrl.trim();
    return Rule.parse(base);
  });
  return Rulebook.parse({ region, label, notLegalAdvice: true, rules });
}

/** Re-tag every rule in an already-valid Rulebook to the target region/label. */
function finalize(rulebook: Rulebook, region: string, label: string): Rulebook {
  const seen = new Set<string>();
  const rules = rulebook.rules.map((r) => Rule.parse({ ...r, region, id: uniqueId(r.id, seen) }));
  return Rulebook.parse({ region, label, notLegalAdvice: true, rules });
}

function deriveLabel(raw: unknown, fallback: string): string {
  const l = (raw as { label?: unknown }).label;
  return typeof l === 'string' && l.trim() ? l.trim() : fallback;
}

function uniqueId(id: string, seen: Set<string>): string {
  let candidate = id || 'rule';
  let n = 2;
  while (seen.has(candidate)) candidate = `${id}-${n++}`;
  seen.add(candidate);
  return candidate;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'rule';
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
