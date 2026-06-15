// src/agents/conductor.ts
import type { AgentHandler } from '../band/types';
import type { ContentAsset } from '../domain/types';
import { matchParticipant } from './handles';
import { tryParseAsset } from '../domain/load';

export interface ConductorOptions {
  podLeadHandles: string[];   // ['@claims-lead', '@reg-lead', '@brand-lead']
  primeHandles?: string[];    // e.g. ['@remediation'] so it caches the asset for later rewrites
}

export function makeConductor(opts: ConductorOptions): AgentHandler {
  return async (message, tools) => {
    // A fresh asset, or a 'revised' asset coming back from remediation (the one loop).
    let asset: ContentAsset | null = tryParseAsset(message.content);
    if (!asset) {
      try {
        const b = JSON.parse(message.content) as { kind?: string; revised?: ContentAsset };
        if (b?.kind === 'revised' && b.revised) asset = b.revised;
      } catch { /* not JSON */ }
    }
    if (!asset) return;

    await tools.sendEvent(`Intake: dispatching ${asset.id} to ${opts.podLeadHandles.length} pods`, 'intake', { asset: asset.id });
    const participants = await tools.getParticipants();
    for (const handle of [...opts.podLeadHandles, ...(opts.primeHandles ?? [])]) {
      const t = matchParticipant(participants, handle, 'agent');
      if (t) await tools.sendMessage(JSON.stringify(asset), [{ id: t.id, handle: t.handle }]);
    }
  };
}
