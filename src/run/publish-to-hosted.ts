// Publish the locally-seeded campaigns + their generated media to the HOSTED
// backend so everyone who opens the Vercel site sees them. We upload the media we
// already generated locally (Vertex images + Veo videos) through the hosted
// /api/images and /api/videos endpoints (which mirror to GCS, so they survive a
// redeploy) and create the campaigns via /api/campaigns. No Cloud Run redeploy is
// needed: this only uses endpoints the deployed backend already has.
//
//   pnpm exec tsx src/run/publish-to-hosted.ts
//   BACKEND=https://... pnpm exec tsx src/run/publish-to-hosted.ts   (override target)

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BACKEND = (process.env.BACKEND ?? 'https://band-backend-1068570846548.us-east1.run.app').replace(/\/$/, '');
const DATA_DIR = new URL('../../data/', import.meta.url).pathname;
const IDS = ['novapay-launch-q3', 'lumora-retinol-renew', 'voltleaf-energy-launch'];

type Material = Record<string, unknown> & { id: string; kind: string; imageUrl?: string; videoUrl?: string };
type Ad = { id: string; name: string; markets?: string[]; materials: Material[] };
type Campaign = { id: string; name: string; markets: string[]; dossier: unknown; advertisements: Ad[] };

function localPath(url: string): string | undefined {
  const m = /^\/api\/(images|videos)\/(.+)$/.exec(url);
  if (!m) return undefined;
  const p = join(DATA_DIR, m[1]!, m[2]!);
  return existsSync(p) ? p : undefined;
}

async function uploadMedia(kind: 'image' | 'video', filePath: string, campaignId: string, materialId: string, advertisementId?: string): Promise<string | undefined> {
  const bytes = readFileSync(filePath);
  const isVideo = kind === 'video';
  const form = new FormData();
  const field = isVideo ? 'video' : 'image';
  const name = isVideo ? 'clip.mp4' : 'image.png';
  const type = isVideo ? 'video/mp4' : 'image/png';
  form.append(field, new Blob([bytes], { type }), name);
  form.append('campaignId', campaignId);
  form.append('materialId', materialId);
  if (advertisementId) form.append('advertisementId', advertisementId);
  const res = await fetch(`${BACKEND}/api/${isVideo ? 'videos' : 'images'}`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`${kind} upload HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { imageUrl?: string; videoUrl?: string };
  return isVideo ? json.videoUrl : json.imageUrl;
}

async function main(): Promise<void> {
  console.log(`publishing to ${BACKEND}`);
  const all = JSON.parse(readFileSync(join(DATA_DIR, 'campaigns.json'), 'utf8')) as Campaign[];
  const mine = all.filter((c) => IDS.includes(c.id));
  if (mine.length !== IDS.length) console.warn(`warning: found ${mine.length}/${IDS.length} expected campaigns locally`);

  for (const camp of mine) {
    console.log(`\n=== ${camp.name} (${camp.id}) ===`);

    // 1) Create the campaign first, with media URLs stripped (local urls do not
    //    resolve on the host; the uploads below attach the hosted urls).
    const stripped: Campaign = {
      ...camp,
      advertisements: camp.advertisements.map((ad) => ({
        ...ad,
        materials: ad.materials.map((m) => {
          const { imageUrl, videoUrl, ...rest } = m;
          return rest as Material;
        }),
      })),
    };
    const createRes = await fetch(`${BACKEND}/api/campaigns`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(stripped),
    });
    if (!createRes.ok) { console.error(`  [campaign] FAILED HTTP ${createRes.status}: ${(await createRes.text()).slice(0, 200)}`); continue; }
    console.log(`  [campaign] created`);

    // 2) Upload each material's media (auto-attaches to imageUrl/videoUrl on the host).
    for (const ad of camp.advertisements) {
      for (const m of ad.materials) {
        if (m.imageUrl) {
          const p = localPath(m.imageUrl);
          if (!p) { console.warn(`  [img] ${m.id}: local file missing for ${m.imageUrl}`); continue; }
          try {
            const url = await uploadMedia('image', p, camp.id, m.id);
            console.log(`  [img] ${m.id} -> ${url}`);
          } catch (e) { console.error(`  [img] ${m.id} FAILED: ${(e as Error)?.message ?? e}`); }
        }
        if (m.videoUrl) {
          const p = localPath(m.videoUrl);
          if (!p) { console.warn(`  [vid] ${m.id}: local file missing for ${m.videoUrl}`); continue; }
          try {
            const url = await uploadMedia('video', p, camp.id, m.id, ad.id);
            console.log(`  [vid] ${m.id} -> ${url}`);
          } catch (e) { console.error(`  [vid] ${m.id} FAILED: ${(e as Error)?.message ?? e}`); }
        }
      }
    }
  }

  console.log('\npublish complete.');
  process.exit(0);
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
