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
    return <p className="text-sm text-red-600">Missing review id.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link to="/history" className="text-sm text-indigo-600 hover:text-indigo-500">
          &larr; All reviews
        </Link>
        <Link
          to="/"
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
        >
          + Compose campaign
        </Link>
      </div>

      {connectionError && state.status === 'running' ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
          Live connection interrupted. The browser will attempt to reconnect.
        </div>
      ) : null}

      <BoardView state={state} />
    </div>
  );
}
