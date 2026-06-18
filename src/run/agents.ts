// Real runner: connects the pods -> board -> spine cast to band.ai and keeps the
// process alive. Create the room in app.band.ai, add these agents plus the human
// reviewer, then post a marketing asset @mentioning the Conductor.
//
//   pnpm agents     (needs each agent's API key + a model provider in .env)
//
// Cast (17 agents + the human): Conductor; the Claims pod (Scout, Claim &
// Evidence, Precedent, Disclosure) under a Claims Lead; the Regulatory pod (US,
// EU, LATAM) under a debating Reg Lead; the Brand pod (Brand Voice, Channel,
// Visual) under a Brand Lead; the board (Mediator, Remediation); and the Risk
// Adjudicator. Each agent is a band.ai agent with its own PREFIX_AGENT_ID /
// PREFIX_API_KEY in .env (see AGENT_ENV_PREFIX below for the prefix per role).

import 'dotenv/config';
import { createServer } from 'node:http';
import { RealBandTransport } from '../band/real';
import { connectPodBoardAgents, type PodBoardModels } from '../board/pod-board';
import type { AgentConnection, BandTransport, ConnectOptions } from '../band/types';
import { activeMode, describeRoutes, imageClientFor, modelFor } from '../models/route';
import { findCampaignByName, loadBrandDna, loadRulebook } from '../domain/load';
import type { ContentAsset } from '../domain/types';
import { Store } from '../store/store';
import { makePublishArtifact } from '../store/artifacts';
import type { Artifact, NewArtifact } from '../domain/artifact';
import { spend } from '../models/spend';
import { makeRunForwarder } from './run-forward';

// A small, dependency-free HTML page for a report artifact: the report text with
// URLs linkified and any promo images shown as a gallery. Rendered at GET /a/:id so
// the link the Adjudicator posts into band.ai opens a readable report in the browser.
function renderArtifactHtml(a: Artifact): string {
  const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
  const images: string[] = [];
  const body = esc(a.content ?? a.src ?? '').replace(/https?:\/\/[^\s)]+/g, (u) => {
    if (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(u) || /\/api\/images\//.test(u)) images.push(u);
    return `<a href="${u}" target="_blank" rel="noopener">${u}</a>`;
  });
  const gallery = images.length
    ? `<h2>Promotional images</h2><div class=g>${images.map((u) => `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="promo"></a>`).join('')}</div>`
    : '';
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(a.title)}</title>
<style>:root{color-scheme:light dark}body{font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:780px;margin:0 auto;padding:40px 22px;color:#16161d}h1{font-size:21px;margin:0 0 4px}h2{font-size:16px;margin-top:28px}.m{color:#8a8a99;font-size:13px;margin-bottom:22px}.r{white-space:pre-wrap;background:#f7f7fb;border:1px solid #ececf3;border-radius:12px;padding:20px}a{color:#3b6cf6;word-break:break-all}.g{display:flex;flex-wrap:wrap;gap:12px;margin-top:10px}.g img{width:200px;height:auto;border-radius:10px;border:1px solid #ececf3}</style>
</head><body><h1>${esc(a.title)}</h1><div class=m>${esc(a.createdBy ?? 'Review board')}</div><div class=r>${body}</div>${gallery}</body></html>`;
}

const ASSETS = new URL('../../assets/', import.meta.url).pathname;
const DATA_DIR = new URL('../../data/', import.meta.url).pathname;

// connectPodBoardAgents wires every agent with a fixed agentId. On real Band each
// of those identities is a distinct registered agent, so map the fixed agentId to
// the env prefix that holds its PREFIX_AGENT_ID / PREFIX_API_KEY.
const AGENT_ENV_PREFIX: Record<string, string> = {
  cond: 'CONDUCTOR',
  claimslead: 'CLAIMS_LEAD',
  scout: 'SCOUT',
  ce: 'CLAIM_EVIDENCE',
  prec: 'PRECEDENT',
  disc: 'DISCLOSURE',
  reglead: 'REG_LEAD',
  us: 'US',
  eu: 'EU',
  latam: 'LATAM',
  brandlead: 'BRAND_LEAD',
  bv: 'BRAND_VOICE',
  ch: 'CHANNEL',
  vis: 'VISUAL',
  med: 'MEDIATOR',
  rem: 'REMEDIATION',
  adj: 'ADJUDICATOR',
};

// Thin decorator: injects each agent's env-prefixed credentials (mirroring the
// per-agent envPrefix pattern) before delegating to the real transport, so the
// shared connectPodBoardAgents wiring runs unchanged against Band Cloud.
class CredentialedTransport implements BandTransport {
  constructor(private readonly inner: RealBandTransport) {}

  connectAgent(opts: ConnectOptions): Promise<AgentConnection> {
    const prefix = AGENT_ENV_PREFIX[opts.agentId];
    if (!prefix) return this.inner.connectAgent(opts);
    return this.inner.connectAgent({
      ...opts,
      agentId: process.env[`${prefix}_AGENT_ID`] ?? opts.agentId,
      envPrefix: prefix,
    });
  }
}

async function main(): Promise<void> {
  const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
  const usRules = loadRulebook(`${ASSETS}rulebook.us.json`);
  const euRules = loadRulebook(`${ASSETS}rulebook.eu.json`);
  const latamRules = loadRulebook(`${ASSETS}rulebook.latam.json`);

  console.log(`Model mode: ${activeMode()}`);
  console.log('Routes:', describeRoutes());

  const models: PodBoardModels = {
    scout: modelFor('scout'), claim: modelFor('claim'), precedent: modelFor('precedent'), disclosure: modelFor('disclosure'),
    us: modelFor('us'), eu: modelFor('eu'), latam: modelFor('latam'),
    brand: modelFor('brand'), channel: modelFor('channel'), visual: modelFor('visual'),
    mediator: modelFor('mediator'), remediationCopy: modelFor('remediation'), image: imageClientFor(),
  };

  const store = new Store(DATA_DIR);

  // Single source of truth: the DEPLOYED backend. Campaigns shown in the Vercel UI
  // are fetched from here so a human can review ANY of them from band.ai, and the
  // reports the agents publish go back to the same backend (so the UI shows them).
  const BACKEND = (process.env.REPORT_BACKEND ?? 'https://band-backend-1068570846548.us-east1.run.app').replace(/\/+$/, '');
  const APP = (process.env.PUBLIC_BASE_URL ?? 'https://artifact-viewer-one.vercel.app').replace(/\/+$/, '');

  // Live run mirror (Stage B): forward this review's lifecycle to the dashboard so
  // the UI shows the band.ai workflow live. Best effort: a forwarding failure (e.g.
  // the runs endpoint not deployed yet) never blocks or breaks the review. Opened
  // when the Conductor resolves a review request (one run per request).
  const runFwd = makeRunForwarder({ backend: BACKEND, warn: (m) => console.warn(`[run] ${m}`) });
  const startRun = (campaignId: string, advertisementId: string | undefined, label: string, total: number): void => {
    void (async () => {
      await runFwd.openRun({ campaignId, ...(advertisementId ? { advertisementId } : {}), label, total });
      await runFwd.emit({ stage: 'requested', agent: 'Conductor', message: `Review requested: ${label} (${total} material${total === 1 ? '' : 's'})` });
      await runFwd.emit({ stage: 'reviewing', agent: 'Conductor', message: `Reviewing ${total} material${total === 1 ? '' : 's'} across US, EU, LATAM, and brand.` });
    })();
  };

  // Resolve "@conductor review <campaign> [advertisement]" against the backend, so
  // anything in the dashboard is reviewable. A flat asset reviews as one material; a
  // campaign reviews ALL its materials (or just one advertisement's, when the query
  // names an ad), one at a time. Local data/assets.json is the offline fallback.
  type CampaignSummary = { id?: string; name?: string; markets?: string[] };
  type AdFull = { id?: string; name?: string; materials?: ContentAsset[] };
  type CampaignFull = { id?: string; name?: string; advertisements?: AdFull[] };
  const FILLER = new Set(['the', 'a', 'an', 'review', 'campaign', 'advertisement', 'ad', 'ads', 'please', 'for', 'and', 'of', 'material', 'materials']);
  const tok = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  // Backend image urls are stored relative (/api/images/x.png); make them absolute so
  // the link in the report actually opens (against the deployed dashboard origin).
  const absMaterials = (mats: ContentAsset[]): ContentAsset[] =>
    mats.map((m) => (m.imageUrl?.startsWith('/api/') ? { ...m, imageUrl: `${APP}${m.imageUrl}` } : m));

  const lookupMaterials = async (query: string): Promise<{ name: string; materials: ContentAsset[] } | undefined> => {
    try {
      const [a, c] = await Promise.all([
        fetch(`${BACKEND}/api/assets`).then((r) => r.json() as Promise<{ assets?: ContentAsset[] }>).catch(() => ({ assets: [] as ContentAsset[] })),
        fetch(`${BACKEND}/api/campaigns`).then((r) => r.json() as Promise<{ campaigns?: CampaignSummary[] }>).catch(() => ({ campaigns: [] as CampaignSummary[] })),
      ]);
      // Best name match across flat assets AND campaign summaries in one pass.
      const assets: ContentAsset[] = Array.isArray(a.assets) ? a.assets : [];
      const summaries: ContentAsset[] = (Array.isArray(c.campaigns) ? c.campaigns : [])
        .map((s) => ({ id: s.id ?? '', name: s.name ?? '', channel: '', markets: s.markets ?? [], copy: '', claim: '' }));
      const winner = findCampaignByName([...assets, ...summaries], query);
      if (winner) {
        const direct = assets.find((x) => x.id === winner.id);
        if (direct) {
          startRun(direct.id, undefined, direct.name ?? direct.id, 1);
          return { name: direct.name ?? direct.id, materials: absMaterials([direct]) }; // flat asset = one material
        }
        // A campaign: fetch the full record; review one advertisement (if the query
        // names it) or every material across all advertisements.
        const full = await fetch(`${BACKEND}/api/campaigns/${winner.id}`).then((r) => r.json() as Promise<{ campaign?: CampaignFull }>).catch(() => ({ campaign: undefined }));
        const camp = full.campaign;
        const ads: AdFull[] = Array.isArray(camp?.advertisements) ? camp.advertisements : [];
        const campTokens = new Set(tok(camp?.name ?? ''));
        const qTokens = tok(query).filter((t) => !FILLER.has(t) && !campTokens.has(t));
        let chosen: AdFull | undefined; let best = 0;
        for (const ad of ads) {
          const score = qTokens.filter((t) => new Set(tok(ad.name ?? '')).has(t)).length;
          if (score > best) { best = score; chosen = ad; }
        }
        const materials = (chosen ? chosen.materials : ads.flatMap((ad) => ad.materials ?? [])) ?? [];
        if (materials.length) {
          const label = chosen ? `${camp?.name} / ${chosen.name}` : (camp?.name ?? winner.name ?? winner.id);
          startRun(winner.id, chosen?.id, label, materials.length);
          return { name: label, materials: absMaterials(materials) };
        }
      }
    } catch (err) {
      console.warn(`[campaigns] backend fetch failed (${(err as Error)?.message ?? err}); using local data`);
    }
    const local = findCampaignByName(store.listAssets(), query);
    if (local) {
      startRun(local.id, undefined, local.name ?? local.id, 1);
      return { name: local.name ?? local.id, materials: absMaterials([local]) };
    }
    return undefined;
  };
  const lookupCampaign = async (query: string): Promise<ContentAsset | undefined> => (await lookupMaterials(query))?.materials[0];

  // Serve regenerated promo images over HTTP so Remediation can post a short,
  // clickable link into the Band room (a base64 data URL is too large for band.ai,
  // and Vertex image generation returns base64, not a hosted URL). Self-contained:
  // the runner hosts the image into data/images and serves it here, so no separate
  // web server is needed. The link resolves from the same machine the band.ai UI
  // runs on; set PUBLIC_BASE_URL to override the origin (e.g. a tunnel).
  const imagePort = Number(process.env.IMAGE_PORT ?? 8788);
  const localBase = `http://localhost:${imagePort}`;
  // Reports + images are published to BACKEND (defined above) so the links open in
  // the real dashboard; the local server below is only a fallback host.
  const localPublish = makePublishArtifact(store, localBase);
  const httpServer = createServer((req, res) => {
    const url = req.url ?? '';
    const img = /^\/api\/images\/([^/?#]+)/.exec(url);
    if (img) {
      const buf = store.readImage(img[1]!);
      if (!buf) { res.statusCode = 404; res.end('not found'); return; }
      const ext = img[1]!.split('.').pop()?.toLowerCase();
      res.setHeader('content-type', ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png');
      res.end(buf);
      return;
    }
    // /a/<id> renders the report; /api/artifacts/<id> returns it as JSON (for the SPA).
    const art = /^\/(?:a|api\/artifacts)\/([^/?#]+)/.exec(url);
    if (art) {
      const a = store.getArtifact(art[1]!);
      if (!a) { res.statusCode = 404; res.end('not found'); return; }
      if (url.startsWith('/api/artifacts/')) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ artifact: a }));
      } else {
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(renderArtifactHtml(a));
      }
      return;
    }
    res.statusCode = 404; res.end('not found');
  });
  httpServer.on('error', (err: unknown) => console.warn(`[http] local fallback host not serving on ${imagePort}: ${(err as Error)?.message ?? err}.`));
  httpServer.listen(imagePort, () => console.log(`[http] publishing reports/images to ${APP} (local fallback on ${localBase})`));

  // Publish the report to the deployed backend; the returned link opens in the live
  // dashboard. Fall back to the local viewer only if the backend is unreachable.
  const publishArtifact = async (input: NewArtifact): Promise<{ id: string; url: string }> => {
    try {
      const res = await fetch(`${BACKEND}/api/artifacts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { id } = (await res.json()) as { id: string };
      return { id, url: `${APP}/a/${id}` };
    } catch (err) {
      console.warn(`[artifacts] backend publish failed (${(err as Error)?.message ?? err}); using local viewer`);
      return localPublish(input);
    }
  };

  // Upload a generated image to the deployed backend so it renders in the dashboard;
  // fall back to local hosting. Returns '' on total failure (caller treats as no image).
  const hostImage = async (u: string): Promise<string> => {
    if (/^https?:\/\//.test(u)) return u;
    const m = /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(u);
    if (!m) return u;
    try {
      const form = new FormData();
      form.append('image', new Blob([Buffer.from(m[2]!, 'base64')], { type: m[1] }), 'promo.png');
      const res = await fetch(`${BACKEND}/api/images`, { method: 'POST', body: form });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { imageUrl } = (await res.json()) as { imageUrl: string };
      const hostedUrl = imageUrl.startsWith('/') ? `${APP}${imageUrl}` : imageUrl;
      // A generated image hosted = Remediation proposed a new material; show it on the run.
      void runFwd.onMaterial(hostedUrl);
      return hostedUrl;
    } catch (err) {
      console.warn(`[images] backend upload failed (${(err as Error)?.message ?? err}); using local host`);
      const hosted = store.hostImage(u);
      return hosted?.startsWith('/') ? `${localBase}${hosted}` : (hosted ?? '');
    }
  };

  // Record a per-material verdict on the backend so the dashboard reflects this review
  // (status + report link), even though it ran here in the separate agents process.
  const recordVerdict = async (input: { materialId: string; decision: 'published' | 'spiked' | 'escalated'; reportUrl?: string; reportArtifactId?: string; summary?: string }): Promise<void> => {
    const { materialId, ...body } = input;
    try {
      await fetch(`${BACKEND}/api/materials/${encodeURIComponent(materialId)}/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    } catch (err) {
      console.warn(`[verdict] record failed for ${materialId}: ${(err as Error)?.message ?? err}`);
    }
    // Mirror the verdict onto the live run timeline (report/decision beat + completion).
    void runFwd.onVerdict(input);
  };

  // Live rulebook overrides (UI edits) and recent human-ruling precedents, read
  // per review so the long-lived runner picks them up between reviews.
  const getRulebook = (region: string) =>
    store.getRulebookOverride(region) ?? (region === 'US' ? usRules : region === 'EU' ? euRules : latamRules);
  const getPrecedents = () => store.listPrecedents().slice(-6).map((p) => `${p.regions.join('/')}: ${p.decision}`);

  const transport = new CredentialedTransport(new RealBandTransport());
  // Compact cast (10 agents): Claims and Brand are single solo reviewers, the
  // Regulatory pod keeps its US/EU/LATAM debate. Fits a 14-agent Band.ai room with
  // headroom. Drop `compact` to connect the full 17-agent cast.
  await connectPodBoardAgents(transport, {
    brand,
    rulebooks: { us: usRules, eu: euRules, latam: latamRules },
    models,
    hostImage,
    publishArtifact,
    recordVerdict,
    lookupCampaign,
    lookupMaterials,
    settleMs: 9000,
    getRulebook,
    getPrecedents,
    compact: true,
  });

  console.log(
    'Compact cast connected to band.ai (10 agents). In the room, @mention the Conductor with a campaign. Ctrl+C to stop.',
  );

  // Live spend readout: print the running estimate (Bedrock + Vertex + Featherless
  // calls cost real money) whenever it moves. Also persisted to data/spend.json,
  // which the web console reads.
  let lastUsd = -1;
  setInterval(() => {
    const s = spend.snapshot();
    if (s.totalUsd === lastUsd) return;
    lastUsd = s.totalUsd;
    const top = s.byModel.slice(0, 3).map((m) => `${m.model.split('/').pop()}: $${m.usd.toFixed(4)}`).join(', ');
    console.log(`[spend] est. $${s.totalUsd.toFixed(4)} over ${s.calls} call(s)${top ? ` | ${top}` : ''}`);
  }, 12000);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
