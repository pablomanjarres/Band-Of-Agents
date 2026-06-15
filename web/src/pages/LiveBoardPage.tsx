import { useEffect, useReducer, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { subscribeToEvents } from '../api';
import type { EventSubscription } from '../api';
import { applyEvent, initialBoardState } from '../boardState';
import type { BoardState } from '../boardState';
import { BoardView } from '../components/BoardView';
import type { BoardEvent } from '../types';

function reducer(state: BoardState, action: BoardEvent | { type: '__reset' }): BoardState {
  if (action.type === '__reset') {
    return initialBoardState();
  }
  return applyEvent(state, action);
}

export function LiveBoardPage() {
  const { id } = useParams<{ id: string }>();
  const [state, dispatch] = useReducer(reducer, undefined, initialBoardState);
  const [connectionError, setConnectionError] = useState(false);
  const subscriptionRef = useRef<EventSubscription | null>(null);

  useEffect(() => {
    if (!id) return;

    dispatch({ type: '__reset' });
    setConnectionError(false);

    const subscription = subscribeToEvents(
      id,
      (event) => dispatch(event),
      () => setConnectionError(true),
    );
    subscriptionRef.current = subscription;

    return () => {
      subscription.close();
      subscriptionRef.current = null;
    };
  }, [id]);

  // Close the stream once the review reaches a terminal state.
  useEffect(() => {
    if (state.status === 'complete' || state.status === 'error') {
      subscriptionRef.current?.close();
      subscriptionRef.current = null;
    }
  }, [state.status]);

  if (!id) {
    return <p className="text-sm text-danger">Missing review id.</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Link
          to="/history"
          className="text-sm text-muted transition-colors hover:text-fg"
        >
          ← All reviews
        </Link>
        <Link to="/" className="btn btn-primary">
          + Compose campaign
        </Link>
      </div>

      {connectionError && state.status === 'running' ? (
        <div className="rounded-xl border border-warn/30 bg-warn/[0.07] px-4 py-2.5 text-sm text-warn">
          Live connection interrupted. The browser will attempt to reconnect.
        </div>
      ) : null}

      <BoardView state={state} />
    </div>
  );
}
