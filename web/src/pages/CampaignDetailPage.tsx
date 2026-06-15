import { useEffect, useReducer, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getCampaign,
  getCampaignReview,
  startCampaignReview,
  submitCampaignDecision,
  subscribeToCampaignEvents,
} from '../api';
import type { EventSubscription } from '../api';
import {
  applyCampaignEvent,
  buildMatrix,
  deriveAggregateVerdict,
  initialCampaignState,
} from '../boardState';
import type { CampaignBoardState } from '../boardState';
import { CampaignMatrix } from '../components/CampaignMatrix';
import { DossierEditor } from '../components/DossierEditor';
import { MaterialsTree } from '../components/MaterialsTree';
import { PipelineDiagram } from '../components/PipelineDiagram';
import { StatusBadge } from '../components/StatusBadge';
import { AggregateBadge } from '../components/VerdictBadge';
import type { BoardEvent, Campaign, CampaignRollup } from '../types';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; campaign: Campaign };

type CampaignAction =
  | { kind: 'event'; event: BoardEvent }
  | { kind: 'reset'; campaign: Campaign }
  | { kind: 'rollup'; rollup: CampaignRollup };

// One reducer folds the combined campaign stream into per-material lanes. A
// 'reset' re-seeds the lanes when a fresh review starts (or the campaign reloads);
// 'rollup' attaches the authoritative server rollup (the badge prefers it).
function reducer(state: CampaignBoardState, action: CampaignAction): CampaignBoardState {
  switch (action.kind) {
    case 'reset':
      return initialCampaignState(action.campaign);
    case 'event':
      return applyCampaignEvent(state, action.event);
    case 'rollup':
      return { ...state, rollup: action.rollup };
  }
}

export function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [board, dispatch] = useReducer(reducer, undefined, () => initialCampaignState());
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const subscriptionRef = useRef<EventSubscription | null>(null);

  // Load the campaign (dossier + materials) for the editors and the matrix shape.
  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoad({ kind: 'loading' });
    getCampaign(id)
      .then((res) => {
        if (!active) return;
        setLoad({ kind: 'ready', campaign: res.campaign });
        dispatch({ kind: 'reset', campaign: res.campaign });
      })
      .catch((err: unknown) => {
        if (!active) return;
        setLoad({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to load campaign.' });
      });
    return () => {
      active = false;
    };
  }, [id]);

  // Tear the SSE stream down on unmount.
  useEffect(() => {
    return () => {
      subscriptionRef.current?.close();
      subscriptionRef.current = null;
    };
  }, []);

  // Close the stream once the whole campaign reaches a terminal state.
  useEffect(() => {
    if (board.status === 'complete' || board.status === 'error') {
      subscriptionRef.current?.close();
      subscriptionRef.current = null;
    }
  }, [board.status]);

  function refreshCampaign(next: Campaign) {
    setLoad({ kind: 'ready', campaign: next });
    // Re-seed lanes only while no review is streaming, so editing the dossier or
    // adding a material does not wipe a live matrix.
    if (!reviewId) dispatch({ kind: 'reset', campaign: next });
  }

  async function handleRun() {
    if (load.kind !== 'ready') return;
    setStarting(true);
    setStartError(null);
    try {
      dispatch({ kind: 'reset', campaign: load.campaign });
      const res = await startCampaignReview(load.campaign.id);
      setReviewId(res.id);
      const sub = subscribeToCampaignEvents(res.id, (event) => dispatch({ kind: 'event', event }));
      subscriptionRef.current = sub;
      // Poll the rollup alongside the stream so the badge/matrix reflect the
      // server's authoritative worst-case computation as verdicts land.
      void pollRollup(res.id);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'Failed to start the review.');
    } finally {
      setStarting(false);
    }
  }

  async function pollRollup(rid: string) {
    try {
      const res = await getCampaignReview(rid);
      if (res.rollup) dispatch({ kind: 'rollup', rollup: res.rollup });
      if (res.status !== 'complete' && res.status !== 'error') {
        window.setTimeout(() => void pollRollup(rid), 1500);
      }
    } catch {
      // The stream remains the primary source; a failed poll is non-fatal.
    }
  }

  async function handleDecision(materialId: string, decision: string) {
    if (!reviewId) return;
    await submitCampaignDecision(reviewId, materialId, decision);
  }

  if (load.kind === 'loading') {
    return <p className="text-sm text-slate-500">Loading campaign.</p>;
  }
  if (load.kind === 'error') {
    return (
      <div className="space-y-3">
        <Link to="/campaigns" className="text-sm text-indigo-600 hover:text-indigo-500">
          &larr; All campaigns
        </Link>
        <p className="text-sm text-red-600">{load.message}</p>
      </div>
    );
  }

  const campaign = load.campaign;
  const matrix = buildMatrix(board);
  const aggregate = deriveAggregateVerdict(board);
  const selectedLane = selectedMaterialId ? board.lanes[selectedMaterialId] : undefined;
  const reviewing = Boolean(reviewId);
  // A review is actively streaming only after one started AND the campaign has
  // not yet reached a terminal state. The raw board.status starts as 'running'
  // from initialCampaignState, so gate the button on this, not board.status.
  const inProgress = reviewing && board.status === 'running';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/campaigns" className="text-sm text-indigo-600 hover:text-indigo-500">
            &larr; All campaigns
          </Link>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-xl font-bold text-slate-900">{campaign.name}</h1>
            <AggregateBadge {...(aggregate ? { decision: aggregate } : {})} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          {reviewing ? <StatusBadge status={board.status} /> : null}
          <button
            type="button"
            onClick={handleRun}
            disabled={starting || campaign.materials.length === 0 || inProgress}
            className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            title={campaign.materials.length === 0 ? 'Add a material first' : 'Run a concurrent per-material review'}
          >
            {inProgress ? 'Reviewing.' : starting ? 'Starting.' : reviewing ? 'Re-run review' : 'Run review'}
          </button>
        </div>
      </div>

      {startError ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
          {startError} (In band mode, start reviews from band.ai; the local board runs concurrent
          per-material reviews here.)
        </p>
      ) : null}

      {/* The matrix is the campaign centerpiece: rows = materials, columns =
          regions, every material negotiating CONCURRENTLY. Clicking a cell drills
          into that material's full Live Board below. */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Material x region matrix
          </h2>
          {reviewing ? (
            <span className="text-xs text-slate-400">
              {matrix.length} materials negotiating concurrently
            </span>
          ) : (
            <span className="text-xs text-slate-400">Run a review to populate verdicts</span>
          )}
        </div>
        <CampaignMatrix
          rows={matrix}
          onSelect={setSelectedMaterialId}
          {...(selectedMaterialId ? { selectedMaterialId } : {})}
        />
      </section>

      {/* Drill-in: the selected material's existing Live Board pipeline. */}
      {selectedLane ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              Live board: {selectedLane.material.name ?? selectedLane.material.id}
            </h2>
            <button
              type="button"
              onClick={() => setSelectedMaterialId(undefined)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-slate-50"
            >
              Close
            </button>
          </div>
          <PipelineDiagram state={selectedLane.board} />
          {(selectedLane.board.status === 'awaiting-decision' || selectedLane.board.escalationText) && reviewId ? (
            <EscalationActions
              materialId={selectedLane.material.id}
              onDecision={handleDecision}
            />
          ) : null}
        </section>
      ) : null}

      {/* Composition: the cascading dossier and the nested materials tree. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <DossierEditor campaign={campaign} onSaved={refreshCampaign} />
        <MaterialsTree
          campaign={campaign}
          onAdded={refreshCampaign}
          onSelect={setSelectedMaterialId}
          {...(selectedMaterialId ? { selectedMaterialId } : {})}
        />
      </div>
    </div>
  );
}

// A compact escalation control so a human can rule on one material's deadlock
// without leaving the campaign view (the decision is scoped to that material).
function EscalationActions({
  materialId,
  onDecision,
}: {
  materialId: string;
  onDecision: (materialId: string, decision: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  async function send(decision: string) {
    setSending(true);
    try {
      await onDecision(materialId, decision);
    } finally {
      setSending(false);
      setText('');
    }
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
      <p className="text-sm font-semibold text-amber-900">This material escalated to a human.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Record the compliance ruling."
          className="flex-1 rounded-lg border border-amber-300 bg-white p-2 text-sm text-slate-800 shadow-sm focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
        />
        <button
          type="button"
          disabled={sending || !text.trim()}
          onClick={() => void send(text.trim())}
          className="inline-flex items-center rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? 'Recording.' : 'Record decision'}
        </button>
      </div>
    </div>
  );
}
