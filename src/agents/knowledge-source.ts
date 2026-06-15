// src/agents/knowledge-source.ts
import type { AgentHandler } from '../band/types';
import type { ModelClient } from '../models/client';
import type { ContentAsset } from '../domain/types';
import { matchParticipant } from './handles';
import { tryParseAsset } from '../domain/load';

export interface KnowledgeSourceOptions {
  role: string;                                  // stable key, e.g. 'claim-evidence'
  reviewerName: string;                          // display name in events
  system: string;                                // system prompt
  jsonSchema: unknown;                           // output schema for model.complete
  model: ModelClient;
  reportToHandle: string;                        // pod-lead handle, e.g. '@claims-lead'
  eventType?: string;                            // sendEvent type, default 'review'
  buildUser?: (asset: ContentAsset) => string;   // default: pretty JSON of the asset
  ignoreFromHandle?: string;                     // optional: skip messages from this handle
  images?: (asset: ContentAsset) => string[];    // vision input (image URLs); only image-capable models use them
}

export function makeKnowledgeSource(opts: KnowledgeSourceOptions): AgentHandler {
  const eventType = opts.eventType ?? 'review';
  return async (message, tools) => {
    if (opts.ignoreFromHandle && message.senderName && message.senderName.includes(opts.ignoreFromHandle.replace('@', ''))) return;
    const asset = tryParseAsset(message.content);
    if (!asset) return;
    const user = opts.buildUser ? opts.buildUser(asset) : `Asset (JSON):\n${JSON.stringify(asset, null, 2)}`;
    const imgs = opts.images ? opts.images(asset) : [];
    const res = await opts.model.complete({ system: opts.system, messages: [{ role: 'user', content: user }], jsonSchema: opts.jsonSchema, ...(imgs.length ? { images: imgs } : {}) });
    const payload = (res.json && typeof res.json === 'object') ? (res.json as Record<string, unknown>) : {};
    await tools.sendEvent(`${opts.reviewerName} reviewed ${asset.id}`, eventType, { role: opts.role });
    const target = matchParticipant(await tools.getParticipants(), opts.reportToHandle, 'agent');
    if (target) {
      await tools.sendMessage(JSON.stringify({ source: opts.role, asset: asset.id, ...payload }), [{ id: target.id, handle: target.handle }]);
    }
  };
}
