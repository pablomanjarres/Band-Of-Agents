import type { AgentHandler, Mention, RoomMessage, RoomTools } from '../band/types';
import type { ModelClient } from '../models/client';
import type { BrandDna, ContentAsset, RemediationRequest } from '../domain/types';
import type { PodHub } from '../board/pod-hub';
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
  hostImage?: (url: string) => string;
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
    // The remediation directive arrives as JSON (back-compat) or, on a prose request,
    // is derived from the conflict on the hub.
    let directive = tryParseDirective(message.content);
    // Only the adjudicator's prose request triggers a hub-derived directive (not the
    // conductor's intake prime), otherwise priming would loop into endless rewrites.
    if (!directive && opts.podHub && (message.senderName ?? '').toLowerCase().includes('adjudic')) {
      const c = opts.podHub.conflicts(message.roomId)[0];
      if (c) directive = { kind: 'remediation', region: c.blockedBy[0] ?? 'EU', findings: [{ category: 'claim', severity: 'block', claim: c.span, rationale: c.rationale }] };
    }
    if (!directive) return;
    const base = assetByRoom.get(message.roomId) ?? opts.podHub?.asset(message.roomId);
    if (!base) return;

    const rewritten = await rewriteCopy(opts.copyModel, opts.brand, base, directive);

    let imageUrl: string | undefined;
    let imageNote = '';
    if (opts.imageModel.generateImage) {
      try {
        const img = await opts.imageModel.generateImage({ prompt: localizedImagePrompt(base, directive.region) });
        // AIML returns a hosted URL; the Vertex dev path returns base64. Host the
        // data URL so the revised message stays small (band.ai rejects large ones).
        const raw = img.url ?? (img.b64 ? `data:image/png;base64,${img.b64}` : undefined);
        imageUrl = raw && opts.hostImage ? opts.hostImage(raw) : raw;
        imageNote = imageUrl ? ' + regenerated image' : '';
      } catch {
        imageNote = ' (image generation skipped)';
      }
    }

    const revised: ContentAsset = {
      ...base,
      id: `${base.id}-${directive.region.toLowerCase()}`,
      markets: [directive.region],
      copy: rewritten,
      ...(imageUrl ? { imageUrl } : {}),
    };
    await tools.sendEvent(
      `Remediated ${directive.region}: rewrote copy${imageNote}. Re-submitting for review.`,
      'remediation',
    );
    const target = await resolveTarget(tools, opts.reportToHandle, message);
    if (opts.podHub) {
      // Keep the revised asset off-chat; tell the conductor in plain English.
      opts.podHub.setRevised(message.roomId, revised);
      await tools.sendMessage(`Revised the ${directive.region} copy${imageNote}. Re-submitting "${revised.name ?? revised.id}" for review.`, [target]);
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
