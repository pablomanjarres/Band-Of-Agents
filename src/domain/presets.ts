// Curated one-click rulebook presets read off disk from assets/presets/. Each
// file is a full Rulebook (assets/presets/rulebook.<id>.json). A preset is
// surfaced read-only via GET /api/rulebooks/presets and applied with the existing
// PUT /api/rulebooks/:region after the user picks one.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Rulebook } from './types';
import type { Rulebook as RulebookT } from './types';

export interface RulebookPreset {
  /** Stable id derived from the filename (e.g. "us-ftc"). */
  id: string;
  /** Human-friendly label (the rulebook's own label). */
  label: string;
  /** Region the preset targets (e.g. "US"). */
  region: string;
  /** The full, validated rulebook to apply. */
  rulebook: RulebookT;
}

const PRESET_FILE = /^rulebook\.(.+)\.json$/;

/**
 * Load every curated preset from the given directory. Invalid or unreadable
 * files are skipped (a bad preset must not take down the endpoint), and the
 * result is sorted by id for a stable picker order.
 */
export function loadPresets(dir: string): RulebookPreset[] {
  if (!existsSync(dir)) return [];
  const presets: RulebookPreset[] = [];
  for (const file of readdirSync(dir)) {
    const m = PRESET_FILE.exec(file);
    if (!m) continue;
    const id = m[1]!;
    try {
      const rulebook = Rulebook.parse(JSON.parse(readFileSync(join(dir, file), 'utf8')));
      presets.push({ id, label: rulebook.label, region: rulebook.region, rulebook });
    } catch {
      // Skip a malformed preset rather than failing the whole listing.
    }
  }
  return presets.sort((a, b) => a.id.localeCompare(b.id));
}
