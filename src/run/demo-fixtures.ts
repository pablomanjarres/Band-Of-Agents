// Shared key-free demo scenario for the seeded "Immune+ Q3 Launch" campaign.
// Used by both the console runner (src/run/local.ts) and the HTTP server's
// key-free local mode (src/server/index.ts) so a reviewer-less, no-API-key demo
// still shows the real conflict: the dossier pre-clears the immune claim, so US
// lets the hero video run (with a typical-results note) while EU demands the
// Article 10(2) wording and LATAM demands localization, and the promo banner
// carries an unfixable US negative-option problem that escalates to a human.
// Stubs are keyed by material id, which match the seeded campaign's materials.

import type { BoardModels } from '../board/session';
import { StubModelClient, StubSttClient, type CompleteRequest, type ModelClient, type SttClient } from '../models/client';
import type { Finding } from '../domain/types';

export type FindingsResult = { text: string; json: { findings: Finding[] } };

export function findings(...items: Finding[]): FindingsResult {
  return { text: '', json: { findings: items } };
}

/** Which material a reviewer is looking at, read off the material JSON in the prompt. */
function materialIdOf(req: CompleteRequest): string {
  const first = req.messages[0];
  const text = typeof first?.content === 'string' ? first.content : JSON.stringify(first?.content ?? '');
  const m = /"id":\s*"([^"]+)"/.exec(text);
  return m?.[1] ?? '';
}

// Per-region stub findings keyed by material id, tuned to the seeded copy.
const US_FINDINGS: Record<string, Finding[]> = {
  'hero-video': [
    { category: 'endorsement', severity: 'warn', claim: '9 out of 10 users felt the difference', rationale: 'Add a typical-results note; the 9-out-of-10 testimonial is substantiated on file in the dossier (DF-2026-07).', ruleId: 'us-testimonial' },
  ],
  'launch-post': [],
  'promo-banner': [
    { category: 'pricing', severity: 'block', claim: 'start your free trial today ... delivered monthly', rationale: 'A free trial that auto-converts to monthly billing needs clear up-front auto-renewal terms; as written it is a deceptive negative-option offer, not fixable by a footnote.', ruleId: 'us-negative-option' },
  ],
};

const EU_FINDINGS: Record<string, Finding[]> = {
  'hero-video': [
    { category: 'disclosure', severity: 'block', claim: 'whole material', rationale: 'Health-claim material must carry the Article 10(2) accompanying statements (balanced diet, quantity to consume, target population).', ruleId: 'eu-mandatory-disclosure', requiredDisclosure: 'Article 10(2) accompanying statements' },
  ],
  'launch-post': [],
  'promo-banner': [],
};

const LATAM_FINDINGS: Record<string, Finding[]> = {
  'hero-video': [
    { category: 'localization', severity: 'block', claim: 'whole material', rationale: 'Copy must be localized to Portuguese/Spanish for the LATAM markets.', ruleId: 'latam-localization', requiredDisclosure: 'Localized copy' },
  ],
  'launch-post': [],
  'promo-banner': [],
};

function regionStub(table: Record<string, Finding[]>): ModelClient {
  return new StubModelClient((req) => findings(...(table[materialIdOf(req)] ?? [])));
}

/** The rich key-free reviewer/remediation/image models for the demo campaign. */
export function demoCampaignModels(): BoardModels {
  return {
    us: regionStub(US_FINDINGS),
    eu: regionStub(EU_FINDINGS),
    latam: regionStub(LATAM_FINDINGS),
    brand: new StubModelClient(() => findings()),
    remediationCopy: new StubModelClient(() => ({
      text: 'Apoia o seu bem-estar diario como parte de uma dieta variada e equilibrada e de um estilo de vida saudavel. (Inclui as mencoes do Artigo 10(2).)',
    })),
    image: { model: 'stub-image', complete: async () => ({ text: '' }), generateImage: async () => ({ url: 'https://cdn.aimlapi.com/campaign-latam.png' }) } satisfies ModelClient,
  };
}

/** Stub perception (vision + STT): canned artifacts so the panel animates key-free. */
export function demoPerception(): { vision: ModelClient; stt: SttClient } {
  const vision = new StubModelClient(() => ({
    text: '',
    json: {
      visualDescription: 'Warm flat-lay of Northwind Immune+ bottles with citrus and eucalyptus in morning light, then a close-up as on-screen text fades in.',
      onScreenText: 'Northwind Immune+ | Feel your best, every day | 9 out of 10 felt the difference',
      detectedClaims: ['Helps maintain your immune response', '9 out of 10 users felt the difference in two weeks'],
    },
  }));
  const stt: SttClient = new StubSttClient(() => ({
    text: 'Feeling run down? Northwind Immune plus helps maintain your immune response so you can feel your best, every day. Nine out of ten users felt the difference in two weeks. As part of a varied, balanced diet and a healthy lifestyle.',
  }));
  return { vision, stt };
}
