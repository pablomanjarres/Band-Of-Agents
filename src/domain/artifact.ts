// An artifact is a thing an agent produced (an image, or a structured document)
// that Band cannot display inline. We host it and the agent pastes a link to our
// dashboard viewer (/a/:id), which renders it by kind. See the spec at
// docs/superpowers/specs/2026-06-14-artifact-viewer-design.md.

import { z } from 'zod';

export const ArtifactKind = z.enum(['image', 'markdown', 'json', 'text']);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

export const Artifact = z.object({
  id: z.string(),
  kind: ArtifactKind,
  title: z.string(),
  createdAt: z.number(),
  /** The agent (or role) that produced it. */
  createdBy: z.string().optional(),
  /** The review this belongs to, for the viewer's back-link. Context only. */
  reviewId: z.string().optional(),
  /** image: a hosted path (/api/images/x.png) or an external url. */
  src: z.string().optional(),
  /** markdown / json / text: the inline content. */
  content: z.string().optional(),
});
export type Artifact = z.infer<typeof Artifact>;

// What a caller passes to publish: an Artifact without the fields the registry
// stamps (id, createdAt).
export const NewArtifact = Artifact.omit({ id: true, createdAt: true });
export type NewArtifact = z.infer<typeof NewArtifact>;
