import type { AgentHandler, Mention, RoomMessage, RoomTools } from '../band/types';
import type { ModelClient } from '../models/client';
import type { BrandDna, ContentAsset, Finding, ReviewResult } from '../domain/types';
import type { NewArtifact } from '../domain/artifact';
import type { SharedBoard } from '../board/shared';
import { matchParticipant } from './handles';

export interface RemediationOptions {
  /** In-process data hub. The campaign and findings are read from here; the revision is written here. */
  board: SharedBoard;
  brand: BrandDna;
  copyModel: ModelClient;
  imageModel: ModelClient;
  /** Who to send the revised asset to for re-review (e.g. the coordinator). */
  reportToHandle?: string;
  /**
   * Host a generated image (base64 data URL) and return a short URL. Keeps the
   * revised asset small enough for band.ai (a full data URL is rejected as too
   * large). When absent, the data URL is used as-is (fine for tests/stubs).
   */
  hostImage?: (url: string) => string;
  /**
   * Register an artifact and get back a dashboard viewer URL to paste into the
   * room. Band cannot show the regenerated image inline, so we link to it.
   * Optional: when absent (tests/stubs) the agent just skips the link.
   */
  publishArtifact?: (input: NewArtifact) => { id: string; url: string };
}

// The remediation agent. On reconcile's plain-English request it reads the open
// review off the SharedBoard, finds the region whose blocking finding is fixable
// via a required disclosure, rewrites that region's copy to add it, regenerates a
// localized image (Nano Banana), stores the revised asset on the board, opens a
// re-review, and tells the coordinator in plain English. This closes the adapt ->
// re-review loop. The findings and the revision live on the board, not in chat.
export function makeRemediation(opts: RemediationOptions): AgentHandler {
  return async (message, tools, ctx) => {
    if (message.senderType !== 'agent') return;
    const base = opts.board.campaign(ctx.roomId);
    if (!base) return;

    // Adapt the region(s) reconcile ruled 'adapt' (not every region with a
    // fixable finding): a region can have a fixable block alongside an unfixable
    // one, in which case reconcile escalates it rather than adapting. Respect that.
    const adaptRegions = new Set(
      opts.board.verdicts(ctx.roomId).filter((v) => v.decision === 'adapt').map((v) => v.region),
    );
    const target = opts.board.reviews(ctx.roomId).find((r) => adaptRegions.has(r.region));
    if (!target) return;
    const region = target.region;

    const rewritten = await rewriteCopy(opts.copyModel, opts.brand, base, region, target.findings);

    let imageUrl: string | undefined;
    let imageNote = '';
    if (opts.imageModel.generateImage) {
      try {
        const img = await opts.imageModel.generateImage({ prompt: localizedImagePrompt(base, region) });
        // AIML returns a hosted URL; the Vertex dev path returns base64. Host the
        // data URL so the revised asset stays small (band.ai rejects large ones).
        const raw = img.url ?? (img.b64 ? `data:image/png;base64,${img.b64}` : undefined);
        imageUrl = raw && opts.hostImage ? opts.hostImage(raw) : raw;
        imageNote = imageUrl ? ' + regenerated image' : '';
      } catch {
        imageNote = ' (image generation skipped)';
      }
    }

    const revised: ContentAsset = {
      ...base,
      id: `${base.id}-${region.toLowerCase()}`,
      markets: [region],
      copy: rewritten,
      ...(imageUrl ? { imageUrl } : {}),
    };
    opts.board.setRevised(ctx.roomId, region, revised);
    opts.board.startReReview(ctx.roomId, revised);

    await tools.sendEvent(
      `Remediated ${region}: rewrote copy${imageNote}. Re-submitting for review.`,
      'remediation',
    );

    // Band cannot show the regenerated image inline, so publish it and paste a
    // dashboard link the human can click. Only when we have both a hosted image
    // and the publish capability (tests/stubs skip it).
    let viewLink = '';
    if (imageUrl && opts.publishArtifact) {
      const { url } = opts.publishArtifact({
        kind: 'image',
        title: `${region} visual (revised)`,
        src: imageUrl,
        reviewId: ctx.roomId,
        createdBy: ctx.agentName,
      });
      viewLink = ` View the regenerated visual: ${url}`;
    }

    const reportTo = await resolveTarget(tools, opts.reportToHandle, message);
    const coordTag = reportTo.handle ? `@${reportTo.handle}` : '@Coordinator';
    // Embed the regenerated asset inline (the /api/images url renders as an <img>
    // in the dashboard chat), so the human SEES the rebranded visual, not just a
    // link. The artifact link stays for the full-size click-through.
    const inlineImage = imageUrl ? `\n\n![Regenerated ${region} visual](${imageUrl})` : '';
    await tools.sendMessage(
      `${coordTag}, I rewrote the ${region} copy to add the required disclosure and regenerated the image. Re-submitting for review.${viewLink}${inlineImage}`,
      [reportTo],
    );
  };
}

async function rewriteCopy(
  model: ModelClient,
  brand: BrandDna,
  asset: ContentAsset,
  region: string,
  findings: Finding[],
): Promise<string> {
  const system = `You rewrite marketing copy to fix ${region} compliance issues while staying on-brand. Voice: ${brand.voice.join(', ')}. Never use: ${brand.forbiddenPhrases.join(', ')}. This is a demo, NOT legal advice. Return ONLY the rewritten copy, no preamble.`;
  const findingsText = findings
    .map((f) => `- [${f.severity}] ${f.ruleId ?? f.category}: ${f.rationale}${f.requiredDisclosure ? ` (add: ${f.requiredDisclosure})` : ''}`)
    .join('\n');
  const user = `Original copy:\n${asset.copy}\n\nFix these ${region} findings:\n${findingsText}`;
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
  return { id: message.senderId, ...(message.senderName ? { handle: message.senderName } : {}) };
}
