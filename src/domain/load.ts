import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { BrandDna, ContentAsset, Rulebook } from './types';

function loadJson<S extends z.ZodTypeAny>(path: string, schema: S): z.infer<S> {
  return schema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export const loadBrandDna = (path: string): BrandDna => loadJson(path, BrandDna);
export const loadRulebook = (path: string): Rulebook => loadJson(path, Rulebook);
export const loadAsset = (path: string): ContentAsset => loadJson(path, ContentAsset);

/** Parse a room message body as a ContentAsset, or null if it is not one. */
export function tryParseAsset(content: string): ContentAsset | null {
  try {
    return ContentAsset.parse(JSON.parse(content));
  } catch {
    return null;
  }
}

/**
 * Normalize an intake message into a ContentAsset: use the JSON asset if the
 * message is one, otherwise treat the raw text as the asset copy so a human can
 * post natural marketing copy in the room.
 */
export function toAsset(content: string): ContentAsset {
  return (
    tryParseAsset(content) ?? {
      id: 'adhoc-asset',
      channel: 'post',
      markets: ['US', 'EU'],
      copy: content,
      claim: content,
    }
  );
}
