import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getReview } from '../api';
import { buildBoardState } from '../boardState';
import type { BoardState } from '../boardState';
import { BoardView } from '../components/BoardView';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; board: BoardState };

export function ReplayBoardPage() {
  const { id } = useParams<{ id: string }>();
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoad({ kind: 'loading' });

    getReview(id)
      .then((replay) => {
        if (!active) return;
        const board = buildBoardState(replay.events);
        // Trust the persisted status if the events did not carry a final status line.
        setLoad({ kind: 'ready', board: { ...board, status: replay.status } });
      })
      .catch((err: unknown) => {
        if (!active) return;
        setLoad({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Failed to load review.',
        });
      });

    return () => {
      active = false;
    };
  }, [id]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Link to="/history" className="text-sm text-muted transition-colors hover:text-fg">
          ← All reviews
        </Link>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-3 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted ring-1 ring-inset ring-border-strong">
          Read-only replay
        </span>
      </div>

      {load.kind === 'loading' ? (
        <p className="text-sm text-muted">Loading review…</p>
      ) : load.kind === 'error' ? (
        <p className="text-sm text-danger">{load.message}</p>
      ) : (
        <BoardView state={load.board} />
      )}
    </div>
  );
}
