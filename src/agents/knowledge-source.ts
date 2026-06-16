// src/agents/knowledge-source.ts
import type { AgentHandler } from '../band/types';
import type { ModelClient } from '../models/client';
import type { ContentAsset, Finding } from '../domain/types';
import type { PodHub } from '../board/pod-hub';
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
  hub?: PodHub;                                  // when set, read the asset from the hub (prose on the wire)
}

export function makeKnowledgeSource(opts: KnowledgeSourceOptions): AgentHandler {
  const eventType = opts.eventType ?? 'review';
  return async (message, tools) => {
    if (opts.ignoreFromHandle && message.senderName && message.senderName.includes(opts.ignoreFromHandle.replace('@', ''))) return;
    const asset = tryParseAsset(message.content) ?? opts.hub?.asset(message.roomId);
    if (!asset) return;
    const user = opts.buildUser ? opts.buildUser(asset) : `Asset (JSON):\n${JSON.stringify(asset, null, 2)}`;
    const imgs = opts.images ? opts.images(asset) : [];
    const res = await opts.model.complete({ system: opts.system, messages: [{ role: 'user', content: user }], jsonSchema: opts.jsonSchema, ...(imgs.length ? { images: imgs } : {}) });
    const payload = (res.json && typeof res.json === 'object') ? (res.json as Record<string, unknown>) : {};
    await tools.sendEvent(`${opts.reviewerName} reviewed ${asset.id}`, eventType, { role: opts.role });
    const target = matchParticipant(await tools.getParticipants(), opts.reportToHandle, 'agent');
    if (!target) return;
    if (opts.hub) {
      // Keep the structured findings off-chat; report a short status in prose.
      const findings = (Array.isArray(payload['findings']) ? payload['findings'] : []) as Finding[];
      opts.hub.setFinding(message.roomId, opts.role, findings);
      const workItems = Array.isArray(payload['workItems']) ? payload['workItems'] : null;
      const summary = workItems
        ? `mapped ${workItems.length} risky surface(s)`
        : findings.length === 0 ? 'no issues found' : `flagged ${findings.length} issue${findings.length === 1 ? '' : 's'}`;
      await tools.sendMessage(`${opts.reviewerName}: ${summary}.`, [{ id: target.id, handle: target.handle }]);
    } else {
      await tools.sendMessage(JSON.stringify({ source: opts.role, asset: asset.id, ...payload }), [{ id: target.id, handle: target.handle }]);
    }
  };
}
