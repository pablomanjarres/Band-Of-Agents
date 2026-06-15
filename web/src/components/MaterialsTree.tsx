import { useState } from 'react';
import { addMaterial, uploadVideo } from '../api';
import type { Campaign, Material, MaterialKind } from '../types';

interface MaterialsTreeProps {
  campaign: Campaign;
  onAdded: (campaign: Campaign) => void;
  onSelect: (materialId: string) => void;
  selectedMaterialId?: string;
}

const MATERIAL_KINDS: MaterialKind[] = ['video', 'post', 'image', 'banner'];
const MARKET_OPTIONS = ['US', 'EU', 'LATAM'] as const;

const KIND_TONE: Record<MaterialKind, string> = {
  video: 'bg-violet-100 text-violet-700',
  post: 'bg-sky-100 text-sky-700',
  image: 'bg-teal-100 text-teal-700',
  banner: 'bg-amber-100 text-amber-700',
};

function KindPill({ kind }: { kind: MaterialKind }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${KIND_TONE[kind]}`}
    >
      {kind}
    </span>
  );
}

function MaterialRow({
  material,
  nested,
  onSelect,
  selectedMaterialId,
}: {
  material: Material;
  nested?: boolean;
  onSelect: (materialId: string) => void;
  selectedMaterialId?: string;
}) {
  const isSelected = material.id === selectedMaterialId;
  return (
    <button
      type="button"
      onClick={() => onSelect(material.id)}
      className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left transition ${
        isSelected
          ? 'border-indigo-300 bg-indigo-50/60'
          : 'border-slate-200 bg-white hover:bg-slate-50'
      } ${nested ? 'ml-5' : ''}`}
    >
      <KindPill kind={material.kind} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-800">
          {material.name ?? material.id}
        </span>
        <span className="block truncate text-xs text-slate-400">
          {material.claim || material.copy || 'no copy'}
        </span>
        {material.videoUrl ? (
          <span className="mt-0.5 block truncate text-[11px] text-violet-500">
            video: {material.videoUrl}
          </span>
        ) : null}
      </span>
      {material.markets.length > 0 ? (
        <span className="flex flex-wrap justify-end gap-1">
          {material.markets.map((market) => (
            <span
              key={market}
              className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500"
            >
              {market}
            </span>
          ))}
        </span>
      ) : null}
    </button>
  );
}

// The nested materials tree (one level of attachments: a video owns its derived
// posts/images). The add-material form posts to /api/campaigns/:id/materials with
// a kind selector and, for video kinds, a video URL field.
export function MaterialsTree({
  campaign,
  onAdded,
  onSelect,
  selectedMaterialId,
}: MaterialsTreeProps) {
  const [showForm, setShowForm] = useState(false);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Materials</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            {campaign.materials.length}{' '}
            {campaign.materials.length === 1 ? 'material' : 'materials'} in this campaign.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((open) => !open)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm transition hover:bg-slate-50"
        >
          {showForm ? 'Cancel' : '+ Add material'}
        </button>
      </div>

      {campaign.materials.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No materials yet. Add the first one below.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {campaign.materials.map((material) => (
            <li key={material.id} className="space-y-2">
              <MaterialRow
                material={material}
                onSelect={onSelect}
                {...(selectedMaterialId ? { selectedMaterialId } : {})}
              />
              {material.attachments && material.attachments.length > 0 ? (
                <ul className="space-y-2">
                  {material.attachments.map((child) => (
                    <li key={child.id}>
                      <MaterialRow
                        material={child}
                        nested
                        onSelect={onSelect}
                        {...(selectedMaterialId ? { selectedMaterialId } : {})}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {showForm ? (
        <AddMaterialForm
          campaign={campaign}
          onAdded={(next) => {
            onAdded(next);
            setShowForm(false);
          }}
        />
      ) : null}
    </section>
  );
}

const labelClass = 'block text-xs font-medium uppercase tracking-wide text-slate-500';
const inputClass =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-800 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400';

function AddMaterialForm({
  campaign,
  onAdded,
}: {
  campaign: Campaign;
  onAdded: (campaign: Campaign) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<MaterialKind>('post');
  const [channel, setChannel] = useState('instagram');
  const [copy, setCopy] = useState('');
  const [claim, setClaim] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [markets, setMarkets] = useState<string[]>([...campaign.markets]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleMarket(market: string) {
    setMarkets((prev) =>
      prev.includes(market) ? prev.filter((m) => m !== market) : [...prev, market],
    );
  }

  // Upload a chosen video file to the perception pipeline. The server hosts it
  // and returns a served url; we drop that into the videoUrl field so submit (and
  // the next review's perception pass: frames + vision + STT) picks it up. Posting
  // the campaignId also attaches the url server-side as a convenience.
  async function handleVideoUpload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const res = await uploadVideo(file, { campaignId: campaign.id });
      setVideoUrl(res.videoUrl);
      setUploadName(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload the video.');
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!copy.trim() || !claim.trim()) {
      setError('Copy and claim are required.');
      return;
    }
    setSaving(true);
    setError(null);
    const isVideo = kind === 'video';
    try {
      const res = await addMaterial(campaign.id, {
        name: name.trim() || `${kind}-${campaign.materials.length + 1}`,
        kind,
        channel: channel.trim() || 'instagram',
        markets,
        copy: copy.trim(),
        claim: claim.trim(),
        ...(isVideo && videoUrl.trim() ? { videoUrl: videoUrl.trim() } : {}),
      });
      onAdded(res.campaign);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add material.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="material-name">
            Name
          </label>
          <input
            id="material-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={inputClass}
            placeholder="e.g. Hero video"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="material-kind">
            Kind
          </label>
          <select
            id="material-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as MaterialKind)}
            className={inputClass}
          >
            {MATERIAL_KINDS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </div>

      {kind === 'video' ? (
        <div className="space-y-3 rounded-lg border border-violet-200 bg-violet-50/50 p-3">
          <div>
            <span className={labelClass}>
              Upload video{' '}
              <span className="font-normal lowercase text-slate-400">
                (perceived on the next review)
              </span>
            </span>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-sm font-medium text-violet-700 shadow-sm transition hover:bg-violet-50">
                <input
                  type="file"
                  accept="video/*"
                  className="sr-only"
                  disabled={uploading}
                  onChange={(event) => {
                    void handleVideoUpload(event.target.files?.[0]);
                    // Reset so re-selecting the same file fires onChange again.
                    event.target.value = '';
                  }}
                />
                {uploading ? 'Uploading.' : 'Choose video file'}
              </label>
              {uploadName ? (
                <span className="inline-flex items-center gap-1 text-xs text-violet-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  {uploadName} uploaded
                </span>
              ) : null}
            </div>
          </div>
          <div>
            <label className={labelClass} htmlFor="material-video">
              Video URL{' '}
              <span className="font-normal lowercase text-slate-400">
                (or paste a hosted url)
              </span>
            </label>
            <input
              id="material-video"
              type="text"
              value={videoUrl}
              onChange={(event) => setVideoUrl(event.target.value)}
              className={inputClass}
              placeholder="https://.../hero.mp4"
            />
          </div>
        </div>
      ) : null}

      <div>
        <label className={labelClass} htmlFor="material-copy">
          Copy
        </label>
        <textarea
          id="material-copy"
          value={copy}
          onChange={(event) => setCopy(event.target.value)}
          rows={3}
          className={inputClass}
          placeholder="The marketing copy for this material."
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="material-claim">
          Claim
        </label>
        <input
          id="material-claim"
          type="text"
          value={claim}
          onChange={(event) => setClaim(event.target.value)}
          className={inputClass}
          placeholder="The central claim this material makes."
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="material-channel">
            Channel
          </label>
          <input
            id="material-channel"
            type="text"
            value={channel}
            onChange={(event) => setChannel(event.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <span className={labelClass}>Markets</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {MARKET_OPTIONS.map((market) => (
              <label
                key={market}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 shadow-sm"
              >
                <input
                  type="checkbox"
                  checked={markets.includes(market)}
                  onChange={() => toggleMarket(market)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
                />
                {market}
              </label>
            ))}
          </div>
        </div>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        type="submit"
        disabled={saving}
        className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? 'Adding.' : 'Add material'}
      </button>
    </form>
  );
}
