import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getArtifact } from '../api';
import type { Artifact } from '../types';

// The viewer behind the links agents paste into Band. Band cannot show a file or
// image inline, so the agent links here and we render the artifact by kind.
export function ArtifactViewerPage() {
  const { id } = useParams<{ id: string }>();
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [error, setError] = useState<'notfound' | 'failed' | null>(null);

  useEffect(() => {
    if (!id) return;
    let live = true;
    setArtifact(null);
    setError(null);
    getArtifact(id)
      .then((res) => {
        if (live) setArtifact(res.artifact);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setError(String(err).includes('404') ? 'notfound' : 'failed');
      });
    return () => {
      live = false;
    };
  }, [id]);

  if (error === 'notfound') {
    return <Shell title="Artifact not found">
      <p className="text-sm text-muted">This link points to an artifact that does not exist (or was cleared).</p>
    </Shell>;
  }
  if (error === 'failed') {
    return <Shell title="Could not load artifact">
      <p className="text-sm text-muted">Something went wrong fetching this artifact. Try again.</p>
    </Shell>;
  }
  if (!artifact) {
    return <Shell title="Loading artifact...">
      <p className="text-sm text-faint">Fetching...</p>
    </Shell>;
  }

  return (
    <Shell title={artifact.title} createdBy={artifact.createdBy} reviewId={artifact.reviewId}>
      <ArtifactBody artifact={artifact} />
    </Shell>
  );
}

function Shell({
  title,
  createdBy,
  reviewId,
  children,
}: {
  title: string;
  createdBy?: string;
  reviewId?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-fg">{title}</h1>
          {createdBy ? <p className="mt-1 text-xs text-muted">Published by {createdBy}</p> : null}
        </div>
        <Link
          to={reviewId ? `/reviews/${reviewId}` : '/'}
          className="btn btn-ghost shrink-0 px-3 py-1.5 text-sm"
        >
          {reviewId ? 'Back to review' : 'Back to console'}
        </Link>
      </div>
      <div className="surface rounded-2xl p-6">{children}</div>
    </div>
  );
}

export function ArtifactBody({ artifact }: { artifact: Artifact }) {
  switch (artifact.kind) {
    case 'image':
      return artifact.src ? (
        <div className="flex justify-center rounded-lg bg-bg-soft p-4">
          <img src={artifact.src} alt={artifact.title} className="max-h-[70vh] w-auto rounded-md" />
        </div>
      ) : (
        <p className="text-sm text-muted">This image artifact has no source.</p>
      );
    case 'markdown':
      return <Markdown source={artifact.content ?? ''} />;
    case 'json':
      return <pre className="overflow-x-auto rounded-lg bg-bg-soft p-4 text-xs leading-relaxed text-fg">{prettyJson(artifact.content ?? '')}</pre>;
    default:
      // text and any unexpected kind: render as preformatted text.
      return <pre className="whitespace-pre-wrap break-words text-sm text-fg">{artifact.content ?? ''}</pre>;
  }
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

// A deliberately small markdown renderer: headings, bullet lists, bold, and
// inline links. The reports we render are ours, so this covers them without
// pulling in a markdown dependency. Exported so the live ReviewChat feed renders
// the same way (campaign images become real <img>, not raw ![](...) text).
export function Markdown({ source }: { source: string }) {
  const lines = source.split('\n');
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];

  const flushList = (key: number): void => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={`ul-${key}`} className="my-2 list-disc space-y-1 pl-5 text-sm text-muted">
        {list.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  lines.forEach((line, i) => {
    if (line.startsWith('### ')) {
      flushList(i);
      blocks.push(<h3 key={i} className="mt-4 text-sm font-bold text-fg">{renderInline(line.slice(4))}</h3>);
    } else if (line.startsWith('## ')) {
      flushList(i);
      blocks.push(<h2 key={i} className="mt-5 text-base font-bold text-fg">{renderInline(line.slice(3))}</h2>);
    } else if (line.startsWith('# ')) {
      flushList(i);
      blocks.push(<h1 key={i} className="text-lg font-bold text-fg">{renderInline(line.slice(2))}</h1>);
    } else if (line.startsWith('- ')) {
      list.push(line.slice(2));
    } else if (line.trim() === '') {
      flushList(i);
    } else {
      flushList(i);
      blocks.push(<p key={i} className="my-2 text-sm text-muted">{renderInline(line)}</p>);
    }
  });
  flushList(lines.length);

  return <div>{blocks}</div>;
}

// Inline rendering: markdown images ![alt](url), **bold**, and bare URLs become links.
// The image pattern is first in the alternation so a ![](http...) is rendered as an
// image, not split into a bare link. Kept simple on purpose.
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(!\[[^\]]*\]\([^)]+\)|\*\*[^*]+\*\*|https?:\/\/\S+)/g).filter((p) => p !== '');
  return parts.map((part, i) => {
    const img = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(part);
    if (img) {
      return (
        <img
          key={i}
          src={img[2]}
          alt={img[1] || 'material'}
          className="my-2 block max-h-72 w-auto rounded-lg border border-border bg-bg-soft"
        />
      );
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-fg">{part.slice(2, -2)}</strong>;
    }
    if (/^https?:\/\//.test(part)) {
      // A bare image URL (e.g. a campaign image pasted as a plain link) renders as
      // an actual inline image, not a link you have to click away to.
      if (/\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i.test(part) || part.includes('/api/images/')) {
        return (
          <img
            key={i}
            src={part}
            alt="material"
            className="my-2 block max-h-72 w-auto rounded-lg border border-border bg-bg-soft"
          />
        );
      }
      return (
        <a key={i} href={part} className="text-accent underline" target="_blank" rel="noreferrer">
          {part}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}
