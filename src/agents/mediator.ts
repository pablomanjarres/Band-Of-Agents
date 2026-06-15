// src/agents/mediator.ts
import type { AgentHandler } from '../band/types';
import type { ModelClient } from '../models/client';
import type { PodHub } from '../board/pod-hub';
import { matchParticipant } from './handles';
import { MEDIATION_JSON_SCHEMA } from '../domain/board';

export interface MediatorOptions {
  model: ModelClient;
  reportToHandle: string; // '@adjudicator'
  hub?: PodHub;           // when set, read conflicts from the hub (prose on the wire)
}

export function makeMediator(opts: MediatorOptions): AgentHandler {
  return async (message, tools) => {
    let body: { kind?: string; conflicts?: unknown } | null = null;
    try { body = JSON.parse(message.content); } catch { body = null; }
    // Conflicts arrive as JSON (back-compat) or via the hub on a prose request.
    const fromContent = body && body.kind === 'mediate' ? body.conflicts : null;
    const fromHub = !fromContent && opts.hub && (message.senderName ?? '').toLowerCase().includes('adjudic')
      ? opts.hub.conflicts(message.roomId)
      : null;
    const conflicts = (fromContent ?? fromHub) as unknown[] | null;
    if (!conflicts || conflicts.length === 0) return;

    const res = await opts.model.complete({
      system: 'You are the Mediator at a marketing compliance review board. Given the conflicts (a span some reviewers block and others pass), propose the smallest resolution that satisfies every mandate. If none exists, set resolved=false. If a disclosure unlocks it, put the exact text in requiredDisclosure. Return JSON. This is not legal advice.',
      messages: [{ role: 'user', content: `Conflicts: ${JSON.stringify(conflicts)}` }],
      jsonSchema: MEDIATION_JSON_SCHEMA,
    });
    const out = (res.json ?? {}) as { resolved?: boolean; note?: string; requiredDisclosure?: string | null };
    const result = {
      kind: 'mediation' as const,
      resolved: out.resolved ?? false,
      note: out.note ?? '',
      requiredDisclosure: out.requiredDisclosure ?? null,
    };
    await tools.sendEvent(`Mediator: ${result.resolved ? 'resolved' : 'no movement'}`, 'mediation', { resolved: result.resolved });
    const target = matchParticipant(await tools.getParticipants(), opts.reportToHandle, 'agent');
    const mention = target ? [{ id: target.id, handle: target.handle }] : [{ id: message.senderId }];
    if (opts.hub) {
      opts.hub.setMediation(message.roomId, result);
      await tools.sendMessage(`Mediator: ${result.resolved ? 'a resolution exists' : 'no movement'}${result.note ? ` (${result.note})` : ''}.`, mention);
    } else {
      await tools.sendMessage(JSON.stringify(result), mention);
    }
  };
}
