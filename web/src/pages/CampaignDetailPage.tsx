import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { createAdvertisement, getCampaign, saveCampaign } from '../api';
import { AddMaterialForm } from '../components/AddMaterialForm';
import { AdvertisementTabs } from '../components/AdvertisementTabs';
import { DossierEditor } from '../components/DossierEditor';
import { MaterialCard } from '../components/MaterialCard';
import { MaterialDetail } from '../components/MaterialDetail';
import { ReviewChat } from '../components/ReviewChat';
import { ReportPanel } from '../components/ReportPanel';
import { RunTimeline } from '../components/RunTimeline';
import { useRunFeed } from '../runFeed';
import type { Campaign, MaterialReview, RunStatus, VerdictDecision } from '../types';

/** A past review the judge ran, kept in localStorage so chats/reports are not lost. */
interface ReviewHistoryEntry {
  reviewId: string;
  adId: string;
  label: string;
  reportArtifactId?: string;
  ts: number;
}

function historyKey(campaignId: string): string {
  return `band.reviewHistory.${campaignId}`;
}
function loadHistory(campaignId: string): ReviewHistoryEntry[] {
  try {
    const raw = localStorage.getItem(historyKey(campaignId));
    return raw ? (JSON.parse(raw) as ReviewHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; campaign: Campaign };

// Reviews run in band.ai, not in this UI. The dashboard reflects the REAL verdict
// the agents persist on each material (material.review). Worst-case across a set of
// materials drives the ad tab + campaign badge. published (ok) < escalated (needs a
// human ruling) < spiked (blocked) is the severity order.
type ReviewDecision = MaterialReview['decision'];
const REVIEW_RANK: Record<ReviewDecision, number> = { published: 0, escalated: 1, spiked: 2 };
const REVIEW_TONE: Record<ReviewDecision, string> = {
  published: 'bg-human/15 text-human ring-human/30',
  spiked: 'bg-danger/15 text-danger ring-danger/30',
  escalated: 'bg-warn/15 text-warn ring-warn/30',
};
const REVIEW_LABEL: Record<ReviewDecision, string> = {
  published: 'published',
  spiked: 'spiked',
  escalated: 'needs decision',
};
// The ad-tab dots reuse the live verdict palette (publish/adapt/escalate).
const REVIEW_TO_VERDICT: Record<ReviewDecision, VerdictDecision> = {
  published: 'publish',
  escalated: 'adapt',
  spiked: 'escalate',
};

function worstReview(reviews: MaterialReview[]): ReviewDecision | undefined {
  return reviews.reduce<ReviewDecision | undefined>(
    (acc, r) => (acc === undefined || REVIEW_RANK[r.decision] > REVIEW_RANK[acc] ? r.decision : acc),
    undefined,
  );
}

function reviewsOf(materials: { review?: MaterialReview }[]): MaterialReview[] {
  return materials.map((m) => m.review).filter((r): r is MaterialReview => Boolean(r));
}

export function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [tab, setTab] = useState<'advertisements' | 'dossier'>('advertisements');
  const [selectedAdId, setSelectedAdId] = useState<string | undefined>(undefined);
  const [detailMaterialId, setDetailMaterialId] = useState<string | undefined>(undefined);
  const [showAddMaterial, setShowAddMaterial] = useState(false);
  const [showAddAd, setShowAddAd] = useState(false);
  // When set, opens the live chat with the agents scoped to this advertisement.
  const [chatAdId, setChatAdId] = useState<string | null>(null);
  // Remember the running review per advertisement so closing + reopening the panel
  // resumes the same review instead of starting a new one.
  const [reviewByAd, setReviewByAd] = useState<Record<string, string>>({});
  // The report currently shown in the left pane (set when the agents publish one).
  const [reportArtifactId, setReportArtifactId] = useState<string | null>(null);
  // The review the open panel is streaming, so a published report attaches to the
  // right history entry.
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);
  // Persisted history of the judge's reviews (chats + reports), so nothing is lost
  // on reload. Loaded per campaign from localStorage; saved on every change.
  const [history, setHistory] = useState<ReviewHistoryEntry[]>([]);
  // Live band.ai run mirror: polls this campaign's runs and streams the active one
  // into the left pane (complements the interactive ReviewChat).
  const { runs, activeRun, selectRun, removeRun } = useRunFeed(id);
  useEffect(() => {
    if (id) setHistory(loadHistory(id));
  }, [id]);
  useEffect(() => {
    if (id) {
      try { localStorage.setItem(historyKey(id), JSON.stringify(history)); } catch { /* quota/full: skip */ }
    }
  }, [id, history]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoad({ kind: 'loading' });
    getCampaign(id)
      .then((res) => {
        if (!active) return;
        setLoad({ kind: 'ready', campaign: res.campaign });
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

  function refreshCampaign(next: Campaign) {
    setLoad({ kind: 'ready', campaign: next });
    setSelectedAdId((prev) => (prev && next.advertisements.some((a) => a.id === prev) ? prev : next.advertisements[0]?.id));
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

  const allMaterials = campaign.advertisements.flatMap((a) => a.materials);
  const campaignVerdict = worstReview(reviewsOf(allMaterials));

  const worstByAd: Record<string, VerdictDecision | undefined> = {};
  for (const ad of campaign.advertisements) {
    const worst = worstReview(reviewsOf(ad.materials));
    worstByAd[ad.id] = worst ? REVIEW_TO_VERDICT[worst] : undefined;
  }

  const detailMaterial = detailMaterialId
    ? allMaterials.find((m) => m.id === detailMaterialId)
    : undefined;
  const detailAdId = detailMaterialId
    ? campaign.advertisements.find((a) => a.materials.some((m) => m.id === detailMaterialId))?.id
    : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/campaigns" className="text-sm text-muted transition-colors hover:text-fg">← All campaigns</Link>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="font-display text-4xl leading-none text-fg">{campaign.name}</h1>
            {campaignVerdict ? <VerdictPill decision={campaignVerdict} /> : <span className="text-xs text-faint">not reviewed</span>}
          </div>
          <p className="mt-2 font-mono text-[11px] text-faint">
            Product campaign · {campaign.advertisements.length} advertisement{campaign.advertisements.length === 1 ? '' : 's'} ·{' '}
            {allMaterials.length} materials
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/[0.06] px-3 py-2">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          <p className="text-xs text-muted">
            Reviews run in <span className="font-medium text-accent">band.ai</span>. Mention <span className="font-mono text-fg">@Conductor</span> with the advertisement to start.
          </p>
        </div>
      </div>

      {/* Two-pane workspace: LEFT = live review with the agents (or the run mirror); MAIN = ads + materials. */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {chatAdId ? (() => {
          const chatAd = campaign.advertisements.find((a) => a.id === chatAdId);
          return (
            <div className="w-full lg:order-2 lg:sticky lg:top-6 lg:w-[30rem] lg:shrink-0">
              <ReviewChat
                key={chatAdId}
                campaignId={campaign.id}
                advertisementId={chatAdId}
                campaignName={campaign.name}
                {...(chatAd ? { advertisementName: chatAd.name } : {})}
                {...(reviewByAd[chatAdId] ? { reviewId: reviewByAd[chatAdId] } : {})}
                onReviewStarted={(rid, label) => {
                  setReviewByAd((prev) => ({ ...prev, [chatAdId]: rid }));
                  setActiveReviewId(rid);
                  setHistory((prev) =>
                    prev.some((h) => h.reviewId === rid)
                      ? prev
                      : [...prev, { reviewId: rid, adId: chatAdId, label: label ?? chatAd?.name ?? 'Review', ts: Date.now() }],
                  );
                }}
                onReport={(artifactId) => {
                  setReportArtifactId(artifactId);
                  setHistory((prev) => prev.map((h) => (h.reviewId === activeReviewId ? { ...h, reportArtifactId: artifactId } : h)));
                }}
                onClose={() => setChatAdId(null)}
              />
            </div>
          );
        })() : (
        <aside className="lg:order-2 lg:sticky lg:top-6 lg:w-80 lg:shrink-0 space-y-3">
          <div className="surface rounded-2xl p-4">
            <p className="eyebrow">Live processing</p>
            {activeRun ? (
              <div className="mt-3">
                <RunTimeline run={activeRun} onOpenReport={(artifactId) => setReportArtifactId(artifactId)} />
              </div>
            ) : (
              <>
                <div className="mt-3 flex aspect-video w-full items-center justify-center rounded-xl border border-dashed border-border-strong bg-bg-soft/60 px-3 text-center text-xs text-faint">
                  A review streams here live. Open a review chat, or mention <span className="font-mono text-fg">@Conductor</span> in band.ai; the report opens on the left when the agents finish.
                </div>
                {campaignVerdict ? (
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-xs text-faint">Campaign worst-case:</span>
                    <VerdictPill decision={campaignVerdict} />
                  </div>
                ) : null}
              </>
            )}
          </div>

          {runs.length > 1 ? (
            <div className="surface rounded-2xl p-4">
              <p className="eyebrow">Recent runs</p>
              <ul className="mt-2 space-y-1">
                {runs.map((r) => (
                  <li key={r.id} className="group flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => selectRun(r.id)}
                      className={`flex flex-1 items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                        activeRun?.id === r.id ? 'bg-accent/10 text-fg' : 'text-muted hover:bg-bg-soft/60 hover:text-fg'
                      }`}
                    >
                      <span className="truncate">{r.label}</span>
                      <RunStatusDot status={r.status} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeRun(r.id)}
                      title="Delete this run"
                      aria-label="Delete run"
                      className="shrink-0 rounded-md px-1.5 py-1 text-faint opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {history.length > 0 ? (
            <div className="surface rounded-2xl p-4">
              <p className="eyebrow">Your reviews</p>
              <ul className="mt-2 space-y-1.5">
                {[...history].sort((a, b) => b.ts - a.ts).map((h) => (
                  <li key={h.reviewId}>
                    <button
                      type="button"
                      onClick={() => {
                        if (h.reportArtifactId) setReportArtifactId(h.reportArtifactId);
                        setChatAdId(h.adId);
                        setActiveReviewId(h.reviewId);
                        setReviewByAd((prev) => ({ ...prev, [h.adId]: h.reviewId }));
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/[0.06]"
                    >
                      <span className="truncate text-fg/90">{h.label}</span>
                      <span className="shrink-0 text-[10px] text-faint">{h.reportArtifactId ? 'report' : '…'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
        )}

        <section className="min-w-0 flex-1 space-y-4 lg:order-1">
          {reportArtifactId ? (
            <div className="surface rounded-2xl p-4 lg:p-5">
              <div className="flex items-center justify-between">
                <p className="eyebrow">Review report</p>
                <button type="button" onClick={() => setReportArtifactId(null)} className="text-[11px] text-faint hover:text-fg">Clear</button>
              </div>
              <div className="mt-3">
                <ReportPanel artifactId={reportArtifactId} />
              </div>
            </div>
          ) : null}

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
                        onClick={() => setChatAdId(selectedAd.id)}
                        disabled={selectedAd.materials.length === 0}
                        className="btn border border-violet-400/40 bg-violet-500/10 px-3 py-1.5 text-violet-200 hover:bg-violet-500/15"
                        title="Open a live chat with the agents to review this advertisement"
                      >
                        Open review chat
                      </button>
                      <ReviewInBand command={`@Conductor review the ${selectedAd.name} advertisement`} />
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

      {/* Slide-over: the material itself, with its real band.ai verdict (not the agent diagram). */}
      {detailMaterial ? (
        <MaterialDetail
          key={detailMaterial.id}
          material={detailMaterial}
          campaignId={campaign.id}
          {...(detailAdId ? { advertisementId: detailAdId } : {})}
          onClose={() => setDetailMaterialId(undefined)}
          onTranscribed={async () => {
            const refreshed = await getCampaign(campaign.id);
            refreshCampaign(refreshed.campaign);
          }}
          onSave={async (patch) => {
            // Patch this material in place and persist the whole campaign (upsert),
            // then refresh so the edit shows immediately.
            const updated: Campaign = {
              ...campaign,
              advertisements: campaign.advertisements.map((ad) =>
                detailAdId && ad.id !== detailAdId
                  ? ad
                  : {
                      ...ad,
                      materials: ad.materials.map((m) =>
                        m.id === detailMaterial.id ? { ...m, ...patch } : m,
                      ),
                    },
              ),
            };
            const res = await saveCampaign(updated);
            refreshCampaign(res.campaign);
          }}
        />
      ) : null}

    </div>
  );
}

function VerdictPill({ decision }: { decision: ReviewDecision }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset ${REVIEW_TONE[decision]}`}>
      {REVIEW_LABEL[decision]}
    </span>
  );
}

const RUN_STATUS_DOT: Record<RunStatus, string> = {
  running: 'bg-accent',
  'awaiting-decision': 'bg-warn',
  complete: 'bg-human',
  error: 'bg-danger',
};
function RunStatusDot({ status }: { status: RunStatus }) {
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${RUN_STATUS_DOT[status]}`} title={status} />;
}

// Reviews happen in band.ai. This copies the exact mention to paste into the room,
// so the dashboard hands off to the agents instead of running a fake local review.
function ReviewInBand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(command);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1800);
        } catch {
          // Clipboard may be unavailable; the title still shows the command.
        }
      }}
      className="btn border border-accent/40 bg-accent/10 px-3 py-1.5 text-accent hover:bg-accent/15"
      title={`Copies "${command}" to paste into the band.ai room`}
    >
      {copied ? 'Copied, paste in band.ai' : 'Review in band.ai'}
    </button>
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
