// The publish path: an agent hands us a NewArtifact, we persist it and return a
// dashboard URL the agent can paste into a Band message. Split from the Store so
// the URL building is testable without a filesystem, and so agents depend on a
// narrow `publishArtifact` capability, not the whole store.

import { randomUUID } from 'node:crypto';
import type { Artifact, NewArtifact } from '../domain/artifact';

export interface ArtifactSink {
  saveArtifact(artifact: Artifact): void;
}

export interface PublishedArtifact {
  id: string;
  url: string;
}

/** Join a base origin and an artifact id into the viewer URL, with one slash. */
export function buildArtifactUrl(baseUrl: string, id: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/a/${id}`;
}

export type PublishArtifact = (input: NewArtifact) => PublishedArtifact;

/**
 * Build the publish capability bound to a store and the public origin. `now` is
 * injected so the stamped createdAt is deterministic in tests.
 */
export function makePublishArtifact(
  store: ArtifactSink,
  baseUrl: string,
  now: () => number = () => Date.now(),
): PublishArtifact {
  return (input) => {
    const id = randomUUID();
    const artifact: Artifact = { ...input, id, createdAt: now() };
    store.saveArtifact(artifact);
    return { id, url: buildArtifactUrl(baseUrl, id) };
  };
}
