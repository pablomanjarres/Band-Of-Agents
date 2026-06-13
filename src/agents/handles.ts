import type { Participant } from '../band/types';

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Resolve a target participant from a configured handle like
 * '@pablomanjarres/reconcile'. band.ai's getParticipants exposes the participant
 * name (e.g. 'Reconcile'), not the namespaced handle, so we match the handle's
 * last segment ('reconcile') against the participant name or handle. Optionally
 * restrict to a participant type; if a type is given and nothing matches by
 * name/handle, the first participant of that type is returned (so escalation
 * still reaches a human, etc.).
 */
export function matchParticipant(
  participants: Participant[],
  target: string,
  type?: 'agent' | 'user',
): Participant | undefined {
  const segment = target.replace(/^@/, '').split('/').pop() ?? target;
  const key = norm(segment);
  const pool = type ? participants.filter((p) => p.type === type) : participants;
  const hit = pool.find((p) => norm(p.name).includes(key) || norm(p.handle).includes(key));
  if (hit) return hit;
  return type ? pool[0] : undefined;
}
