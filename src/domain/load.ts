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

// Words that carry no campaign identity, dropped before matching.
const CAMPAIGN_FILLER = new Set([
  'review', 'campaign', 'the', 'please', 'for', 'a', 'an', 'conductor', 'check',
  'run', 'my', 'asset', 'this', 'on', 'of', 'and', 'can', 'you', 'lets',
]);

/**
 * Resolve a human's free-text reference (for example "@conductor review the
 * VitaBoost Focus campaign") to a saved campaign. Matches on shared distinctive
 * tokens, so a partial or reordered name still resolves; returns the best match
 * (most tokens shared), or undefined when nothing meaningful overlaps.
 */
export function findCampaignByName(assets: ContentAsset[], query: string): ContentAsset | undefined {
  const tokens = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const queryTokens = tokens(query).filter((t) => !CAMPAIGN_FILLER.has(t));
  if (queryTokens.length === 0) return undefined;
  let best: ContentAsset | undefined;
  let bestScore = 0;
  for (const asset of assets) {
    if (!asset.name) continue;
    const nameTokens = new Set(tokens(asset.name));
    const score = queryTokens.filter((t) => nameTokens.has(t)).length;
    if (score > bestScore) {
      bestScore = score;
      best = asset;
    }
  }
  return bestScore > 0 ? best : undefined;
}
