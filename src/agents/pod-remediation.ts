import type { AgentHandler, Mention, RoomMessage, RoomTools } from '../band/types';
import type { ModelClient } from '../models/client';
import type { BrandDna, ContentAsset, RemediationRequest } from '../domain/types';
import type { PodHub, SplitVersion } from '../board/pod-hub';
import { RemediationRequest as RemediationRequestSchema } from '../domain/types';
import { tryParseAsset } from '../domain/load';
import { matchParticipant } from './handles';

export interface RemediationOptions {
  brand: BrandDna;
  copyModel: ModelClient;
  imageModel: ModelClient;
  /** Who to send the revised asset to for re-review (e.g. the coordinator). */
  reportToHandle?: string;
  /**
   * Host a generated image (base64 data URL) and return a short URL. Keeps the
   * revised message small enough for band.ai (a full data URL is rejected as too
   * large). When absent, the data URL is used as-is (fine for tests/stubs).
   */
  hostImage?: (url: string) => string | Promise<string>;
  /** Shared pod hub: read the asset from here when the conductor primes in prose. */
  podHub?: PodHub;
}

// The remediation agent: caches the asset as it goes round, and on a remediation
// request (an 'adapt' verdict from reconcile) rewrites the copy to fix that
// region's findings and regenerates a localized image (Nano Banana), then posts
// the revised, region-specific asset back for re-review. This closes the
// bidirectional loop, not a one-shot pass.
export function makeRemediation(opts: RemediationOptions): AgentHandler {
  const assetByRoom = new Map<string, ContentAsset>();

  return async (message, tools) => {
    const asset = tryParseAsset(message.content);
    if (asset) {
      assetByRoom.set(message.roomId, asset);
      return;
    }
    if (message.senderType !== 'agent') return;

    // SPLIT mode: the Adjudicator handed us a per-market plan (no single shared
    // version can satisfy every market). Produce a tailored version per blocking
    // market and report them back to the Adjudicator (no recommit on a split).
    const fromAdjudicator = (message.senderName ?? '').toLowerCase().includes('adjudic');
    const plan = fromAdjudicator ? opts.podHub?.splitPlan(message.roomId) : undefined;
    if (plan?.length) {
      const base = opts.podHub?.asset(message.roomId) ?? assetByRoom.get(message.roomId);
      if (base) {
        const versions: SplitVersion[] = [];
        for (const { region, findings } of plan) {
          const copy = await rewriteCopy(opts.copyModel, opts.brand, base, { kind: 'remediation', region, findings });
          let imageUrl: string | undefined;
          if (opts.imageModel.generateImage) {
            try {
              const img = await opts.imageModel.generateImage({ prompt: localizedImagePrompt(base, region) });
              const raw = img.url ?? (img.b64 ? `data:image/png;base64,${img.b64}` : undefined);
              imageUrl = raw && opts.hostImage ? await opts.hostImage(raw) : raw;
            } catch { /* keep the copy-only version if the image fails */ }
          }
          versions.push({ region, copy, ...(imageUrl ? { imageUrl } : {}) });
          await tools.sendEvent(`Tailored ${region} version: rewrote copy${imageUrl ? ' + image' : ''}.`, 'remediation');
        }
        opts.podHub!.setSplitVersions(message.roomId, versions);
        opts.podHub!.setSplitPlan(message.roomId, undefined);
        // Reply to the sender (the Adjudicator), which finalizes the per-market verdict.
        const back: Mention = { id: message.senderId };
        for (const v of versions) {
          await tools.sendMessage(`${v.region} version:\n\n"${v.copy}"${v.imageUrl ? `\n\n${v.region} promo image: ${v.imageUrl}` : ''}`, [back]);
        }
        await tools.sendMessage(`Per-market versions ready: ${versions.map((v) => v.region).join(', ')}.`, [back]);
      }
      return;
    }

    // The remediation directive arrives as JSON (back-compat) or, on a prose request,
    // is derived from the conflict on the hub.
    let directive = tryParseDirective(message.content);
    // Only the adjudicator's prose request triggers a hub-derived directive (not the
    // conductor's intake prime), otherwise priming would loop into endless rewrites.
    // Use EVERY blocked span the adjudicator stashed, so one rewrite fixes them all.
    if (!directive && opts.podHub && (message.senderName ?? '').toLowerCase().includes('adjudic')) {
      const cs = opts.podHub.conflicts(message.roomId);
      if (cs.length) {
        const primed = opts.podHub.asset(message.roomId) ?? assetByRoom.get(message.roomId);
        directive = {
          kind: 'remediation',
          region: cs[0]?.blockedBy[0] ?? primed?.markets?.[0] ?? 'EU',
          findings: cs.map((c) => ({ category: 'claim', severity: 'block', claim: c.span, rationale: c.rationale })),
        };
      }
    }
    if (!directive) return;
    const base = opts.podHub?.asset(message.roomId) ?? assetByRoom.get(message.roomId);
    if (!base) return;

    const rewritten = await rewriteCopy(opts.copyModel, opts.brand, base, directive);

    let imageUrl: string | undefined;
    let imageSkipped = false;
    if (opts.imageModel.generateImage) {
      try {
        const img = await opts.imageModel.generateImage({ prompt: localizedImagePrompt(base, directive.region) });
        // AIML returns a hosted URL; the Vertex path returns base64. Host the data URL
        // so the message carries a short, clickable link (a raw data URL is rejected
        // by band.ai as too large).
        const raw = img.url ?? (img.b64 ? `data:image/png;base64,${img.b64}` : undefined);
        imageUrl = raw && opts.hostImage ? await opts.hostImage(raw) : raw;
        imageSkipped = !imageUrl;
      } catch {
        imageSkipped = true;
      }
    }
    const imageNote = imageUrl ? ' + regenerated image' : imageSkipped ? ' (image generation skipped)' : '';

    const revised: ContentAsset = {
      ...base,
      id: `${base.id}-revised`,
      copy: rewritten,
      ...(imageUrl ? { imageUrl } : {}),
    };
    await tools.sendEvent(`Remediated: rewrote the blocked copy${imageNote}. Re-submitting for review.`, 'remediation');
    const target = await resolveTarget(tools, opts.reportToHandle, message);
    if (opts.podHub) {
      // The structured asset goes on the hub for the recommit; the human sees the
      // actual rewritten copy and the new image link here, in plain English.
      opts.podHub.setRevised(message.roomId, revised);
      const imageLine = imageUrl
        ? `\n\nNew promotional image: ${imageUrl}`
        : imageSkipped ? '\n\n(promo image regeneration was skipped)' : '';
      await tools.sendMessage(
        `Here are the proposed fixes:\n\n"${rewritten}"${imageLine}\n\nRe-submitting "${revised.name ?? revised.id}" for review.`,
        [target],
      );
    } else {
      await tools.sendMessage(JSON.stringify({ kind: 'revised', region: directive.region, revised }), [target]);
    }
  };
}

function tryParseDirective(content: string): RemediationRequest | null {
  try {
    const parsed = RemediationRequestSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function rewriteCopy(
  model: ModelClient,
  brand: BrandDna,
  asset: ContentAsset,
  directive: RemediationRequest,
): Promise<string> {
  const system = `You rewrite marketing copy to fix ${directive.region} compliance issues while staying on-brand. Voice: ${brand.voice.join(', ')}. Never use: ${brand.forbiddenPhrases.join(', ')}. This is a demo, NOT legal advice. Return ONLY the rewritten copy, no preamble.`;
  const findingsText = directive.findings
    .map((f) => `- [${f.severity}] ${f.ruleId ?? f.category}: ${f.rationale}${f.requiredDisclosure ? ` (add: ${f.requiredDisclosure})` : ''}`)
    .join('\n');
  const user = `Original copy:\n${asset.copy}\n\nFix these ${directive.region} findings:\n${findingsText}`;
  const res = await model.complete({ system, messages: [{ role: 'user', content: user }] });
  return res.text.trim() || asset.copy;
}

function localizedImagePrompt(asset: ContentAsset, region: string): string {
  const base = asset.imagePrompt ?? 'on-brand product image';
  return `${base}. Localized and compliant for ${region}. Clean, on-brand wellness aesthetic.`;
}

async function resolveTarget(
  tools: RoomTools,
  handle: string | undefined,
  message: RoomMessage,
): Promise<Mention> {
  if (handle) {
    const found = matchParticipant(await tools.getParticipants(), handle, 'agent');
    if (found) return { id: found.id, handle: found.handle };
  }
  return { id: message.senderId };
}
