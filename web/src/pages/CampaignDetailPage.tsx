import { useEffect, useReducer, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  createAdvertisement,
  getCampaign,
  getCampaignReview,
  startCampaignReview,
  submitCampaignDecision,
  subscribeToCampaignEvents,
} from '../api';
import type { EventSubscription } from '../api';
import {
  activePerceivingLanes,
  applyCampaignEvent,
  buildMatrix,
  deriveAggregateVerdict,
  initialCampaignState,
} from '../boardState';
import type { CampaignBoardState } from '../boardState';
import { AddMaterialForm } from '../components/AddMaterialForm';
import { AdvertisementTabs } from '../components/AdvertisementTabs';
import { DossierEditor } from '../components/DossierEditor';
import { MaterialCard } from '../components/MaterialCard';
import { MaterialDetail } from '../components/MaterialDetail';
import { PerceptionPanel } from '../components/PerceptionPanel';
import { Timeline } from '../components/Timeline';
import { StatusBadge } from '../components/StatusBadge';
import { AggregateBadge } from '../components/VerdictBadge';
import type { BoardEvent, Campaign, CampaignRollup, VerdictDecision } from '../types';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; campaign: Campaign };

type CampaignAction =
  | { kind: 'event'; event: BoardEvent }
  | { kind: 'reset'; campaign: Campaign }
  | { kind: 'rollup'; rollup: CampaignRollup };

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

const RANK: Record<VerdictDecision, number> = { publish: 0, adapt: 1, escalate: 2 };

export function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [board, dispatch] = useReducer(reducer, undefined, () => initialCampaignState());
  const [reviewId, setReviewId] = useState<string | null>(null);
  // null = campaign-wide review; an id = review scoped to that one advertisement.
  const [reviewScopeAdId, setReviewScopeAdId] = useState<string | null>(null);
  const [tab, setTab] = useState<'advertisements' | 'dossier'>('advertisements');
  const [selectedAdId, setSelectedAdId] = useState<string | undefined>(undefined);
  const [detailMaterialId, setDetailMaterialId] = useState<string | undefined>(undefined);
  const [debateMaterialId, setDebateMaterialId] = useState<string | undefined>(undefined);
  const [showAddMaterial, setShowAddMaterial] = useState(false);
  const [showAddAd, setShowAddAd] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const subscriptionRef = useRef<EventSubscription | null>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoad({ kind: 'loading' });
    getCampaign(id)
      .then((res) => {
        if (!active) return;
        setLoad({ kind: 'ready', campaign: res.campaign });
        dispatch({ kind: 'reset', campaign: res.campaign });
        setSelectedAdId((prev) => prev ?? res.campaign.advertisements[0]?.id);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setLoad({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to load campaign.' });
      });
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    return () => {
      subscriptionRef.current?.close();
      subscriptionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (board.status === 'complete' || board.status === 'error') {
      subscriptionRef.current?.close();
      subscriptionRef.current = null;
    }
  }, [board.status]);

  function refreshCampaign(next: Campaign) {
    setLoad({ kind: 'ready', campaign: next });
    setSelectedAdId((prev) => (prev && next.advertisements.some((a) => a.id === prev) ? prev : next.advertisements[0]?.id));
    if (!reviewId) dispatch({ kind: 'reset', campaign: next });
  }

  // Runs a campaign review. With an advertisementId the review is SCOPED to that
  // one ad (still per-material concurrent, reconciled per material): it just runs
  // fewer materials. Without it, the whole campaign is reviewed (unchanged).
  async function handleRun(advertisementId?: string) {
    if (load.kind !== 'ready') return;
    setStarting(true);
    setStartError(null);
    try {
      dispatch({ kind: 'reset', campaign: load.campaign });
      const res = await startCampaignReview(load.campaign.id, advertisementId);
      setReviewId(res.id);
      setReviewScopeAdId(advertisementId ?? null);
      subscriptionRef.current = subscribeToCampaignEvents(res.id, (event) => dispatch({ kind: 'event', event }));
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
      // The stream stays the primary source; a failed poll is non-fatal.
    }
  }

  async function handleDecision(materialId: string, decision: string) {
    if (!reviewId) return;
    await submitCampaignDecision(reviewId, materialId, decision);
  }

  async function handleAddAd(name: string) {
    if (load.kind !== 'ready' || !name.trim()) return;
    const res = await createAdvertisement(load.campaign.id, { name: name.trim() });
    refreshCampaign(res.campaign);
    setSelectedAdId(res.advertisement.id);
    setShowAddAd(false);
  }

  if (load.kind === 'loading') return <p className="text-sm text-muted">Loading campaign…</p>;
  if (load.kind === 'error') {
    return (
      <div className="space-y-3">
        <Link to="/campaigns" className="text-sm text-muted transition-colors hover:text-fg">← All campaigns</Link>
        <p className="text-sm text-danger">{load.message}</p>
      </div>
    );
  }

  const campaign = load.campaign;
  const selectedAd = campaign.advertisements.find((a) => a.id === selectedAdId) ?? campaign.advertisements[0];
  const adMaterialIds = selectedAd?.materials.map((m) => m.id) ?? [];
  const matrix = buildMatrix(board, adMaterialIds);
  const cellsByMaterial = Object.fromEntries(matrix.map((row) => [row.materialId, row.cells]));
  const aggregate = deriveAggregateVerdict(board);
  const perceivingLanes = activePerceivingLanes(board);
  const reviewing = Boolean(reviewId);
  const inProgress = reviewing && board.status === 'running';
  // The ad a scoped review is currently running against (null when campaign-wide).
  const scopedAd = reviewScopeAdId ? campaign.advertisements.find((a) => a.id === reviewScopeAdId) : undefined;

  const worstByAd: Record<string, VerdictDecision | undefined> = {};
  for (const ad of board.rollup?.perAdvertisement ?? []) {
    worstByAd[ad.advertisementId] = ad.worstCaseByRegion.reduce<VerdictDecision | undefined>(
      (acc, r) => (acc === undefined || RANK[r.decision] > RANK[acc] ? r.decision : acc),
      undefined,
    );
  }

  const detailMaterial = detailMaterialId
    ? campaign.advertisements.flatMap((a) => a.materials).find((m) => m.id === detailMaterialId)
    : undefined;
  const detailLane = detailMaterialId ? board.lanes[detailMaterialId] : undefined;
  const debateLane = debateMaterialId ? board.lanes[debateMaterialId] : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/campaigns" className="text-sm text-muted transition-colors hover:text-fg">← All campaigns</Link>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="font-display text-4xl leading-none text-fg">{campaign.name}</h1>
            <AggregateBadge {...(aggregate ? { decision: aggregate } : {})} />
          </div>
          <p className="mt-2 font-mono text-[11px] text-faint">
            Product campaign · {campaign.advertisements.length} advertisement{campaign.advertisements.length === 1 ? '' : 's'} ·{' '}
            {campaign.advertisements.reduce((n, a) => n + a.materials.length, 0)} materials
          </p>
        </div>
        <div className="flex items-center gap-3">
          {reviewing && scopedAd ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 font-mono text-[11px] font-medium text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Scoped: {scopedAd.name}
            </span>
          ) : null}
          {reviewing ? <StatusBadge status={board.status} /> : null}
          <button
            type="button"
            onClick={() => handleRun()}
            disabled={starting || campaign.advertisements.every((a) => a.materials.length === 0) || inProgress}
            className="btn btn-primary"
          >
            {inProgress ? 'Reviewing…' : starting ? 'Starting…' : reviewing ? 'Re-run review' : 'Run review'}
          </button>
        </div>
      </div>

      {startError ? (
        <p className="rounded-xl border border-warn/30 bg-warn/[0.07] px-4 py-2.5 text-sm text-warn">{startError}</p>
      ) : null}

      {/* Two-pane workspace: LEFT = live video processing; MAIN = ads + materials. */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <aside className="lg:sticky lg:top-6 lg:w-80 lg:shrink-0">
          {perceivingLanes.length > 0 ? (
            <PerceptionPanel lanes={perceivingLanes} />
          ) : (
            <div className="surface rounded-2xl p-4">
              <p className="eyebrow">Live processing</p>
              <div className="mt-3 flex aspect-video w-full items-center justify-center rounded-xl border border-dashed border-border-strong bg-bg-soft/60 px-3 text-center text-xs text-faint">
                Each video is analyzed here, frame by frame, while a review runs.
              </div>
              <p className="mt-3 text-xs text-muted">
                Run a review to watch the perception pass (keyframes + transcript) and the
                per-material verdicts land concurrently.
              </p>
              {aggregate ? (
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-xs text-faint">Campaign worst-case:</span>
                  <AggregateBadge decision={aggregate} />
                </div>
              ) : null}
            </div>
          )}
        </aside>

        <section className="min-w-0 flex-1 space-y-4">
          <div className="flex items-center gap-1 border-b border-border">
            <TabButton active={tab === 'advertisements'} onClick={() => setTab('advertisements')}>Advertisements</TabButton>
            <TabButton active={tab === 'dossier'} onClick={() => setTab('dossier')}>Dossier</TabButton>
          </div>

          {tab === 'dossier' ? (
            <DossierEditor campaign={campaign} onSaved={refreshCampaign} />
          ) : (
            <div className="space-y-4">
              <AdvertisementTabs
                advertisements={campaign.advertisements}
                {...(selectedAdId ? { selectedId: selectedAdId } : {})}
                onSelect={(adId) => { setSelectedAdId(adId); setShowAddMaterial(false); }}
                onAdd={() => setShowAddAd(true)}
                worstByAd={worstByAd}
              />

              {showAddAd ? (
                <AddAdvertisement onAdd={handleAddAd} onCancel={() => setShowAddAd(false)} />
              ) : null}

              {selectedAd ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-xl text-fg">
                      {selectedAd.name}
                      <span className="ml-2 font-sans text-xs font-normal text-faint">{selectedAd.materials.length} material{selectedAd.materials.length === 1 ? '' : 's'}</span>
                    </h2>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleRun(selectedAd.id)}
                        disabled={starting || selectedAd.materials.length === 0 || inProgress}
                        className="btn border border-accent/40 bg-accent/10 px-3 py-1.5 text-accent hover:bg-accent/15"
                        title="Review only this advertisement's materials"
                      >
                        {inProgress && reviewScopeAdId === selectedAd.id ? 'Reviewing…' : 'Review this ad'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowAddMaterial((v) => !v)}
                        className="btn btn-ghost px-3 py-1.5"
                      >
                        {showAddMaterial ? 'Cancel' : '+ Add material'}
                      </button>
                    </div>
                  </div>

                  {showAddMaterial ? (
                    <AddMaterialForm
                      campaign={campaign}
                      advertisementId={selectedAd.id}
                      defaultMarkets={selectedAd.markets ?? campaign.markets}
                      onAdded={(next) => { refreshCampaign(next); setShowAddMaterial(false); }}
                      onCancel={() => setShowAddMaterial(false)}
                    />
                  ) : null}

                  {selectedAd.materials.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-border-strong bg-surface/40 px-4 py-8 text-center text-sm text-muted">
                      No materials in this advertisement yet. Add a video, post, image, or banner.
                    </p>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {selectedAd.materials.map((material) => (
                        <MaterialCard
                          key={material.id}
                          material={material}
                          {...(cellsByMaterial[material.id] ? { cells: cellsByMaterial[material.id] } : {})}
                          selected={material.id === detailMaterialId}
                          onClick={() => setDetailMaterialId(material.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="rounded-2xl border border-dashed border-border-strong bg-surface/40 px-4 py-8 text-center text-sm text-muted">
                  No advertisements yet. Add the first one above.
                </p>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Slide-over: the material itself (not the agent diagram). */}
      {detailMaterial ? (
        <MaterialDetail
          material={detailMaterial}
          {...(detailLane ? { board: detailLane.board } : {})}
          reviewed={reviewing}
          onClose={() => setDetailMaterialId(undefined)}
          onViewDebate={() => setDebateMaterialId(detailMaterial.id)}
        />
      ) : null}

      {/* The agents' debate, on demand from the material detail. */}
      {debateLane ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" aria-label="Close" onClick={() => setDebateMaterialId(undefined)} className="absolute inset-0 bg-bg/70 backdrop-blur-sm" />
          <div className="surface-2 relative z-10 flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <h2 className="font-display text-lg text-fg">Agents&apos; debate · {debateLane.material.name ?? debateLane.material.id}</h2>
              <button type="button" onClick={() => setDebateMaterialId(undefined)} className="btn btn-ghost px-2.5 py-1 text-xs">Close</button>
            </div>
            <div className="space-y-3 overflow-y-auto p-5">
              <Timeline events={debateLane.board.events} />
              {(debateLane.board.status === 'awaiting-decision' || debateLane.board.escalationText) && reviewId ? (
                <EscalationActions materialId={debateLane.material.id} onDecision={handleDecision} />
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
        active ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}

function AddAdvertisement({ onAdd, onCancel }: { onAdd: (name: string) => Promise<void> | void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <div className="surface flex flex-wrap items-center gap-2 rounded-2xl p-3">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Advertisement name (e.g. Retargeting)"
        className="flex-1 rounded-xl border border-border-strong bg-bg-soft/70 p-2.5 text-sm text-fg placeholder:text-faint transition-colors focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/25"
      />
      <button
        type="button"
        disabled={saving || !name.trim()}
        onClick={async () => { setSaving(true); try { await onAdd(name); } finally { setSaving(false); } }}
        className="btn btn-primary"
      >
        {saving ? 'Adding…' : 'Add'}
      </button>
      <button type="button" onClick={onCancel} className="btn btn-ghost px-3 py-2">Cancel</button>
    </div>
  );
}

function EscalationActions({ materialId, onDecision }: { materialId: string; onDecision: (materialId: string, decision: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  async function send(decision: string) {
    setSending(true);
    try { await onDecision(materialId, decision); } finally { setSending(false); setText(''); }
  }
  return (
    <div className="rounded-2xl border border-warn/30 bg-warn/[0.07] p-4 shadow-[inset_0_1px_0_rgb(255_255_255/0.04),0_0_28px_-16px_rgb(251_191_36/0.5)]">
      <p className="text-sm font-semibold text-warn">This material escalated to a human.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Record the compliance ruling…"
          className="flex-1 rounded-xl border border-warn/30 bg-bg-soft/70 p-2.5 text-sm text-fg placeholder:text-faint transition-colors focus:border-warn/60 focus:outline-none focus:ring-2 focus:ring-warn/25"
        />
        <button
          type="button"
          disabled={sending || !text.trim()}
          onClick={() => void send(text.trim())}
          className="btn border border-warn/40 bg-warn/10 text-warn hover:bg-warn/15"
        >
          {sending ? 'Recording…' : 'Record decision'}
        </button>
      </div>
    </div>
  );
}
