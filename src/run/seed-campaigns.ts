// Seed new review-ready campaigns with REAL generated media, using the same
// Vertex path the platform itself uses: Nano Banana (gemini-2.5-flash-image) for
// images and Veo (veo-3.0-fast) for the hero videos. Media bytes are hosted
// through the Store (data/images, data/videos) and the campaigns are persisted to
// data/campaigns.json, so the running server surfaces them immediately.
//
// Each campaign is built to exercise the multi-agent conflict, not a linear
// pipeline: the ad copy deliberately overreaches so US (FTC-style substantiation /
// negative-option), EU (strict rulebook / EFSA / cosmetic-claim rules), and LATAM
// (localization) reviewers pull in different directions and have to reconcile.
//
//   GOOGLE_CLOUD_PROJECT=$(gcloud config get-value project) pnpm exec tsx src/run/seed-campaigns.ts
//   SEED_SKIP_VIDEO=1 ... (images only, skip the slow/credit-heavy Veo step)

import 'dotenv/config';
import { GeminiModelClient } from '../models/gemini';
import { Store } from '../store/store';
import { Campaign } from '../domain/types';

const DATA_DIR = new URL('../../data/', import.meta.url).pathname;
const MARKETS = ['US', 'EU', 'LATAM'];

// A raw material: the real schema fields plus optional generation prompts the
// seeder consumes (imagePrompt is a real schema field; videoPrompt is seeder-only
// and is stripped before persisting).
type RawMaterial = Record<string, unknown> & {
  id: string;
  kind: 'video' | 'post' | 'image' | 'banner';
  channel: string;
  markets: string[];
  copy: string;
  claim: string;
  imagePrompt?: string;
  videoPrompt?: string;
};

type RawCampaign = {
  id: string;
  name: string;
  markets: string[];
  dossier: Record<string, unknown>;
  advertisements: Array<{ id: string; name: string; markets?: string[]; materials: RawMaterial[] }>;
};

const CAMPAIGNS: RawCampaign[] = [
  {
    id: 'novapay-launch-q3',
    name: 'NovaPay Card Launch',
    markets: MARKETS,
    dossier: {
      approvedClaims: [
        '0% introductory APR on purchases for the first 18 months',
        'After the intro period a variable APR of 19.99%-28.99% applies, based on creditworthiness',
        'No annual fee; 2% cashback on everyday purchases',
      ],
      substantiation:
        'Intro APR, post-intro variable APR, and fee terms per the NovaPay Cardholder Agreement v2026.1 (ref NP-TC-2026). Cashback rate per the Rewards Schedule. Credit is subject to status and affordability checks.',
      approvedInfo:
        'Always show the post-intro variable APR and a representative example. Credit is subject to status. Do not imply guaranteed/instant approval or that credit is "free money". EU/UK financial promotions must carry the representative APR example and a risk line. Localize disclosures for LATAM markets.',
      sources: [
        { name: 'terms-summary', kind: 'text', content: '0% purchase APR for 18 months from account opening, then 19.99%-28.99% variable. No annual fee. Approval subject to status and affordability.' },
        { name: 'regulatory-notes', kind: 'text', content: 'Consumer-credit promotions must not imply guaranteed approval. UK/EU require a representative example (representative APR). US disclosures follow Reg Z / TILA for the intro-rate offer.' },
      ],
    },
    advertisements: [
      {
        id: 'hero-launch',
        name: 'Hero Launch',
        markets: MARKETS,
        materials: [
          {
            id: 'np-hero-video', name: 'Hero Video', kind: 'video', channel: 'instagram', markets: MARKETS,
            copy: '18 months. Zero interest. The NovaPay card. Spend now, pay on your terms.',
            claim: '0% intro APR for 18 months.',
            videoPrompt: 'Cinematic fintech product hero: a sleek matte-black credit card rotating slowly above a clean glass desk in a sunlit modern apartment, soft reflections, shallow depth of field, premium minimal aesthetic, no on-screen text.',
          },
          {
            id: 'np-hero-thumb', name: 'Hero Thumbnail', kind: 'image', channel: 'instagram', markets: MARKETS,
            copy: 'Meet the NovaPay card. 0% intro APR.',
            claim: '0% intro APR.',
            imagePrompt: 'A premium matte-black credit card resting on a light marble surface beside a small succulent, soft natural morning light, clean fintech product photography, no text.',
          },
        ],
      },
      {
        id: 'retargeting',
        name: 'Retargeting',
        markets: ['US'],
        materials: [
          {
            id: 'np-promo-banner', name: 'Promo Banner', kind: 'banner', channel: 'display', markets: ['US'],
            copy: 'Still on the fence? Get the NovaPay card and start spending like it is free money. Instant approval, 0% APR.',
            claim: 'Instant approval; spend like it is free money.',
            imagePrompt: 'A bright display-banner style product shot of a black credit card floating over a soft gradient background with a glowing call-to-action button shape, energetic and modern, no readable text.',
          },
        ],
      },
      {
        id: 'influencer',
        name: 'Influencer',
        markets: MARKETS,
        materials: [
          {
            id: 'np-influencer-post', name: 'Launch Post', kind: 'post', channel: 'x', markets: MARKETS,
            copy: 'Just got the NovaPay card and I am obsessed. 0% interest for 18 months and 2% back on everything. #ad #partner',
            claim: '0% interest for 18 months; 2% cashback.',
          },
        ],
      },
    ],
  },
  {
    id: 'lumora-retinol-renew',
    name: 'Lumora Retinol Renew',
    markets: MARKETS,
    dossier: {
      approvedClaims: [
        'Helps reduce the appearance of fine lines and wrinkles',
        'Clinically tested for improved skin smoothness',
        'Contains 0.3% encapsulated retinol',
      ],
      substantiation:
        '8-week consumer study, n=110, instrumental and self-assessment measures showed improved appearance of fine lines and skin smoothness; data on file ref LM-CLIN-2026-03. "Clinically tested" refers to this study. This is a cosmetic product, not a medicinal product.',
      approvedInfo:
        'Cosmetic claims only: use "appearance of" wording. Do not claim to treat, cure, reverse aging, or structurally change skin, and do not use "medical-grade". EU Cosmetic Claims Regulation (EU) 655/2013 fairness and evidential-support criteria apply. Localize copy for LATAM (Portuguese/Spanish).',
      sources: [
        { name: 'study-summary', kind: 'text', content: 'n=110, 8 weeks. Improved appearance of fine lines and smoothness vs baseline by self-assessment and instrumental measure. No claim of wrinkle removal or anti-aging cure.' },
        { name: 'regulatory-notes', kind: 'text', content: 'Cosmetic claims must be truthful and evidenced (EU 655/2013). "Reverses aging", "erases wrinkles", and "medical-grade" cross into unsupported or drug-style claims.' },
      ],
    },
    advertisements: [
      {
        id: 'hero-launch',
        name: 'Hero Launch',
        markets: MARKETS,
        materials: [
          {
            id: 'lm-hero-video', name: 'Hero Video', kind: 'video', channel: 'instagram', markets: MARKETS,
            copy: 'Lumora Retinol Renew. Clinically proven to erase wrinkles and reverse the signs of aging in just 4 weeks.',
            claim: 'Clinically proven to erase wrinkles and reverse aging in 4 weeks.',
            videoPrompt: 'Luxury skincare hero: an amber glass serum dropper bottle on a wet stone surface with a single water droplet falling in slow motion, soft diffused studio light, dewy elegant beauty-commercial aesthetic, no on-screen text.',
          },
          {
            id: 'lm-hero-thumb', name: 'Hero Thumbnail', kind: 'image', channel: 'instagram', markets: MARKETS,
            copy: 'Lumora Retinol Renew. Smoother-looking skin in 4 weeks.',
            claim: 'Smoother-looking skin.',
            imagePrompt: 'Close-up of an amber glass skincare serum bottle with a gold dropper on a soft beige background with eucalyptus leaves, gentle morning light, premium clean beauty photography, no text.',
          },
        ],
      },
      {
        id: 'story',
        name: 'Influencer Story',
        markets: MARKETS,
        materials: [
          {
            id: 'lm-story-image', name: 'Influencer Story', kind: 'image', channel: 'instagram', markets: MARKETS,
            copy: 'My nightly glow-up. Lumora visibly smooths the appearance of fine lines. #ad',
            claim: 'Visibly smooths the appearance of fine lines.',
            imagePrompt: 'A warm vertical lifestyle photo: a serum bottle on a bathroom shelf beside a soft towel and a candle, cozy evening light through a window, authentic story-format beauty aesthetic, no text.',
          },
        ],
      },
      {
        id: 'retargeting',
        name: 'Retargeting',
        markets: ['US', 'EU'],
        materials: [
          {
            id: 'lm-promo-banner', name: 'Promo Banner', kind: 'banner', channel: 'display', markets: ['US', 'EU'],
            copy: 'Medical-grade retinol, now without a prescription. Try Lumora risk-free for 30 days.',
            claim: 'Medical-grade retinol; risk-free 30-day trial.',
            imagePrompt: 'A clean display-banner product shot of an amber serum bottle on a white pedestal with a soft pink gradient backdrop and a glowing button shape, premium and minimal, no readable text.',
          },
        ],
      },
    ],
  },
  {
    id: 'voltleaf-energy-launch',
    name: 'VoltLeaf Energy Launch',
    markets: MARKETS,
    dossier: {
      approvedClaims: [
        'Contains natural caffeine from green tea (80 mg per can)',
        'With B-vitamins that contribute to normal energy-yielding metabolism',
        'No added sugar',
      ],
      substantiation:
        'B-vitamin wording follows the EFSA-authorised health claims for vitamins B6, B12 and niacin and normal energy-yielding metabolism. Caffeine content is 80 mg per can per spec ref VL-SPEC-2026. No clinical claim of improved "focus" or "immunity" is substantiated.',
      approvedInfo:
        'Use only EFSA-authorised wording for vitamin claims. Do not claim "boosts focus", "boosts immunity", or any disease-prevention benefit (not substantiated). Carry the high-caffeine advisory where required ("not recommended for children or pregnant or breastfeeding women", 80 mg per can). Localize for LATAM.',
      sources: [
        { name: 'spec-summary', kind: 'text', content: '80 mg natural caffeine per can from green tea. Added B6/B12/niacin. No added sugar. EFSA-authorised vitamin wording only.' },
        { name: 'regulatory-notes', kind: 'text', content: 'EU permits only EFSA-authorised health claims. "Boosts focus" and "boosts immunity" are not authorised. High-caffeine drinks require an advisory statement in the EU.' },
      ],
    },
    advertisements: [
      {
        id: 'hero-launch',
        name: 'Hero Launch',
        markets: MARKETS,
        materials: [
          {
            id: 'vl-hero-video', name: 'Hero Video', kind: 'video', channel: 'youtube', markets: MARKETS,
            copy: 'VoltLeaf. Plant-powered energy that boosts your focus and supercharges your immune system, all day long.',
            claim: 'Boosts focus and supercharges the immune system.',
            videoPrompt: 'High-energy beverage hero: a frosted green energy-drink can on a mossy stone with splashes of water and fresh green tea leaves frozen mid-air, vibrant natural light, dynamic commercial product shot, no on-screen text.',
          },
          {
            id: 'vl-hero-thumb', name: 'Hero Thumbnail', kind: 'image', channel: 'youtube', markets: MARKETS,
            copy: 'VoltLeaf : plant-powered energy.',
            claim: 'Plant-powered energy.',
            imagePrompt: 'A frosted green beverage can standing on a bed of fresh green tea leaves with water droplets, bright clean studio light, vibrant product photography, no text.',
          },
        ],
      },
      {
        id: 'social',
        name: 'Social',
        markets: MARKETS,
        materials: [
          {
            id: 'vl-social-post', name: 'Afternoon Post', kind: 'post', channel: 'instagram', markets: MARKETS,
            copy: 'Afternoon slump? One VoltLeaf and you are locked in. 80 mg natural caffeine, B-vitamins for normal energy metabolism, no added sugar.',
            claim: 'Natural caffeine and B-vitamins for normal energy metabolism.',
          },
        ],
      },
    ],
  },
];

async function main(): Promise<void> {
  const skipVideo = process.env.SEED_SKIP_VIDEO === '1';
  console.log(`seed: project=${process.env.GOOGLE_CLOUD_PROJECT ?? '(unset)'} location=${process.env.GOOGLE_CLOUD_LOCATION ?? '(unset)'} skipVideo=${skipVideo}`);
  const store = new Store(DATA_DIR);
  // Force the Vertex path (the project's own image/video provider) even though an
  // AIML key is present, so this seed is "the same that the platform uses" on GCP.
  const vertex = new GeminiModelClient({ model: 'gemini-2.5-flash', vertexai: true });

  for (const camp of CAMPAIGNS) {
    console.log(`\n=== ${camp.name} (${camp.id}) ===`);
    for (const ad of camp.advertisements) {
      for (const mat of ad.materials) {
        // Image generation (Vertex Nano Banana) for any material with an imagePrompt.
        if (mat.imagePrompt) {
          try {
            const img = await vertex.generateImage({ prompt: mat.imagePrompt });
            if (img.b64) {
              mat.imageUrl = store.hostImageBytes(Buffer.from(img.b64, 'base64'), 'png');
              console.log(`  [img] ${mat.id} -> ${mat.imageUrl}`);
            } else if (img.url) {
              mat.imageUrl = img.url;
              console.log(`  [img] ${mat.id} -> ${img.url} (provider url)`);
            } else {
              console.warn(`  [img] ${mat.id}: no image returned`);
            }
          } catch (e) {
            console.error(`  [img] ${mat.id} FAILED: ${(e as Error)?.message ?? e}`);
          }
        }

        // Video generation (Vertex Veo) for video materials with a videoPrompt.
        if (mat.kind === 'video' && mat.videoPrompt && !skipVideo) {
          const t0 = Date.now();
          try {
            const vid = await vertex.generateVideo({ prompt: mat.videoPrompt, aspectRatio: '16:9' });
            const secs = Math.round((Date.now() - t0) / 1000);
            if (vid.b64) {
              mat.videoUrl = store.hostVideo(Buffer.from(vid.b64, 'base64'), 'mp4');
              console.log(`  [vid] ${mat.id} (${secs}s) -> ${mat.videoUrl}`);
            } else if (vid.url) {
              mat.videoUrl = vid.url;
              console.log(`  [vid] ${mat.id} (${secs}s) -> ${vid.url} (provider uri; not hosted)`);
            } else {
              console.warn(`  [vid] ${mat.id} (${secs}s): no video returned`);
            }
          } catch (e) {
            const secs = Math.round((Date.now() - t0) / 1000);
            console.error(`  [vid] ${mat.id} (${secs}s) FAILED: ${(e as Error)?.message ?? e}`);
          }
        }

        // Strip the seeder-only prompt so it does not leak into persisted data.
        delete mat.videoPrompt;
      }
    }

    // Validate/normalize against the real schema, then persist.
    const parsed = Campaign.safeParse(camp);
    if (!parsed.success) {
      console.error(`  [save] ${camp.id} INVALID:`, parsed.error.issues.slice(0, 5));
      continue;
    }
    store.saveCampaign(parsed.data);
    console.log(`  [save] ${camp.id} persisted (${parsed.data.advertisements.length} ads).`);
  }

  console.log('\nseed complete.');
  process.exit(0);
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
