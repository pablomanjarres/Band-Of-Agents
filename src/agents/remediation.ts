import type { AgentHandler, Mention, RoomMessage, RoomTools } from '../band/types';
import type { ModelClient } from '../models/client';
import type { BrandDna, ContentAsset, RemediationRequest } from '../domain/types';
import { RemediationRequest as RemediationRequestSchema } from '../domain/types';
import { tryParseAsset } from '../domain/load';

export interface RemediationOptions {
  brand: BrandDna;
  copyModel: ModelClient;
  imageModel: ModelClient;
  /** Who to send the revised asset to for re-review (e.g. the coordinator). */
  reportToHandle?: string;
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
    const directive = tryParseDirective(message.content);
    if (!directive) return;
    const base = assetByRoom.get(message.roomId);
    if (!base) return;

    const rewritten = await rewriteCopy(opts.copyModel, opts.brand, base, directive);

    let imageUrl: string | undefined;
    let imageNote = '';
    if (opts.imageModel.generateImage) {
      try {
        const img = await opts.imageModel.generateImage({ prompt: localizedImagePrompt(base, directive.region) });
        // Full image so the console can render it inline. AIML returns a hosted
        // URL; the Vertex dev path returns base64, which we inline as a data URL.
        imageUrl = img.url ?? (img.b64 ? `data:image/png;base64,${img.b64}` : undefined);
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
    await tools.sendMessage(JSON.stringify({ kind: 'revised', region: directive.region, revised }), [target]);
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
    const peers = await tools.getParticipants();
    const found = peers.find((p) => p.handle === handle || p.handle.endsWith(handle));
    if (found) return { id: found.id, handle: found.handle };
  }
  return { id: message.senderId };
}
