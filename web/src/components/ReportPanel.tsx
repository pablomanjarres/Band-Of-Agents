import { useEffect, useState } from 'react';
import { getArtifact } from '../api';
import type { Artifact } from '../types';
import { ArtifactBody } from '../pages/ArtifactViewerPage';

/**
 * Renders a review report (artifact) inline, e.g. in the dashboard's left pane the
 * moment the agents publish it. Fetches the artifact by id and renders it by kind,
 * reusing the same renderer as the full-page viewer.
 */
export function ReportPanel({ artifactId }: { artifactId: string }) {
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setArtifact(null);
    setError(null);
    getArtifact(artifactId)
      .then((res) => { if (live) setArtifact(res.artifact); })
      .catch(() => { if (live) setError('Could not load the report.'); });
    return () => { live = false; };
  }, [artifactId]);

  if (error) return <p className="text-xs text-danger">{error}</p>;
  if (!artifact) return <p className="text-xs text-faint">Loading the report…</p>;

  return (
    <div className="max-h-[70vh] overflow-y-auto">
      <ArtifactBody artifact={artifact} />
      <a href={`/a/${artifactId}`} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs text-accent hover:underline">
        Open full report ↗
      </a>
    </div>
  );
}
