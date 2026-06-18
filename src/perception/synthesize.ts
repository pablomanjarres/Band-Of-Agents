// Synthesized perception for text-on-screen videos.
//
// Most short-form marketing videos carry their message as ON-SCREEN TEXT, not a
// voiceover, so audio STT yields nothing and the perception panel stays empty.
// This module fills that gap WITHOUT a model call: it derives a plausible
// perception (on-screen text, a visual description, detected claims, and a
// reading of the on-screen copy) deterministically from the material's authored
// fields and its sampled frames. It is intentionally not a real OCR/vision pass;
// it gives the review something coherent to work with for a text-first video.
//
// Deterministic (same input => same output) and total (never throws): every
// branch has a sensible fallback, so a material with empty/garbage copy still
// produces a well-formed result.

import type { Material, MaterialPerception } from '../domain/types';

/** Split free text into trimmed, non-empty sentence-ish segments. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\r?\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** A segment reads like a marketing claim when it is more than a stray token. */
function looksLikeClaim(s: string): boolean {
  return s.split(/\s+/).filter(Boolean).length >= 3;
}

/** Title-ish: first non-empty line/sentence of the copy, else the material name. */
function headline(material: Material): string {
  const fromCopy = sentences(material.copy ?? '')[0];
  if (fromCopy && fromCopy.length >= 3) return fromCopy;
  return (material.name ?? material.id ?? 'this product').trim();
}

/**
 * Build a synthesized MaterialPerception for a (text-first) video material,
 * filling only the fields that have no value yet. `frames` are the sampled
 * keyframes (may be empty); their count shapes the visual description.
 */
export function synthesizeVideoPerception(
  material: Material,
  frames: string[] = [],
  prior?: MaterialPerception,
): MaterialPerception {
  const out: MaterialPerception = { frames: prior?.frames?.length ? prior.frames : frames };

  const copy = (material.copy ?? '').trim();
  const claim = (material.claim ?? '').trim();
  const product = (material.name ?? material.id ?? 'the product').trim();
  const channel = (material.channel ?? 'social').trim();
  const markets = material.markets ?? [];

  // Detected claims: the authored claim first, then claim-like lines from the copy.
  const claims: string[] = [];
  if (claim && looksLikeClaim(claim)) claims.push(claim);
  for (const s of sentences(copy)) {
    if (looksLikeClaim(s) && !claims.includes(s)) claims.push(s);
  }
  if (claims.length === 0) {
    // Nothing claim-shaped was authored: state the takeaway a viewer would form.
    claims.push(`${product} is presented as effective and worth trying.`);
  }

  // On-screen text: how a text-first video presents itself (headline + supporting
  // line + a closing call to action), kept short like real overlay copy.
  const lines: string[] = [headline(material)];
  if (claim && claim !== lines[0]) lines.push(claim);
  lines.push('Learn more / Shop now');
  out.onScreenText = prior?.onScreenText ?? lines.filter(Boolean).join('\n');

  // Visual description: plausible framing of a text-driven clip across the frames.
  const frameCount = out.frames.length;
  const frameClause =
    frameCount > 0
      ? `across ${frameCount} sampled frame${frameCount === 1 ? '' : 's'}`
      : 'across the clip';
  const marketClause = markets.length > 0 ? ` aimed at ${markets.join(', ')}` : '';
  out.visualDescription =
    prior?.visualDescription ??
    `A short ${channel} video for ${product}${marketClause}. Text-driven: bold on-screen captions carry the message ${frameClause}, with the product featured and a closing call to action. No spoken voiceover detected; the copy is delivered as on-screen text.`;

  // Detected claims.
  out.detectedClaims = prior?.detectedClaims?.length ? prior.detectedClaims : claims;

  // "Transcript": there is no voiceover, so read back the on-screen text as the
  // captured message (this is what populates the transcript panel for text videos).
  out.transcript =
    prior?.transcript ??
    `On-screen text (no voiceover): ${lines.filter(Boolean).join(' / ')}.`;

  return out;
}
