import { useState } from 'react';
import { addMaterial, uploadImage, uploadVideo } from '../api';
import type { Campaign, MaterialKind } from '../types';
import { Dropzone } from './Dropzone';

interface AddMaterialFormProps {
  campaign: Campaign;
  advertisementId: string;
  defaultMarkets: string[];
  onAdded: (campaign: Campaign) => void;
  onCancel: () => void;
}

const MATERIAL_KINDS: MaterialKind[] = ['video', 'post', 'image', 'banner'];
const MARKET_OPTIONS = ['US', 'EU', 'LATAM'] as const;

const labelClass = 'block text-xs font-medium uppercase tracking-wide text-slate-500';
const inputClass =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-800 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400';

export function AddMaterialForm({ campaign, advertisementId, defaultMarkets, onAdded, onCancel }: AddMaterialFormProps) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<MaterialKind>('video');
  const [channel, setChannel] = useState('instagram');
  const [copy, setCopy] = useState('');
  const [claim, setClaim] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [markets, setMarkets] = useState<string[]>(defaultMarkets);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleMarket(market: string) {
    setMarkets((prev) => (prev.includes(market) ? prev.filter((m) => m !== market) : [...prev, market]));
  }

  async function handleVideo(file: File) {
    setUploading(true);
    setError(null);
    try {
      const res = await uploadVideo(file, { campaignId: campaign.id, advertisementId });
      setVideoUrl(res.videoUrl);
      setUploadName(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload the video.');
    } finally {
      setUploading(false);
    }
  }

  async function handleImage(file: File) {
    setUploading(true);
    setError(null);
    try {
      const res = await uploadImage(file);
      setImageUrl(res.url);
      setUploadName(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload the image.');
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
    try {
      const res = await addMaterial(campaign.id, advertisementId, {
        name: name.trim() || `${kind}-${Date.now().toString().slice(-4)}`,
        kind,
        channel: channel.trim() || 'instagram',
        markets,
        copy: copy.trim(),
        claim: claim.trim(),
        ...(kind === 'video' && videoUrl.trim() ? { videoUrl: videoUrl.trim() } : {}),
        ...(imageUrl.trim() ? { imageUrl: imageUrl.trim() } : {}),
      });
      onAdded(res.campaign);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add material.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="m-name">Name</label>
          <input id="m-name" type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="e.g. Hero spot" />
        </div>
        <div>
          <label className={labelClass} htmlFor="m-kind">Kind</label>
          <select id="m-kind" value={kind} onChange={(e) => setKind(e.target.value as MaterialKind)} className={inputClass}>
            {MATERIAL_KINDS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
      </div>

      {/* Real upload: video for video kinds, image for image/banner kinds. */}
      {kind === 'video' ? (
        <Dropzone accent="violet" accept="video/*" label="Drop a video, or click to choose" hint="perceived (frames + transcript) on the next review" busy={uploading} doneName={uploadName} onFile={handleVideo} />
      ) : (
        <Dropzone accent="teal" accept="image/*" label="Drop an image, or click to choose" hint="shown in the material and reviewed by the vision pass" busy={uploading} doneName={uploadName} onFile={handleImage} />
      )}

      <div>
        <label className={labelClass} htmlFor="m-copy">Copy</label>
        <textarea id="m-copy" value={copy} onChange={(e) => setCopy(e.target.value)} rows={3} className={inputClass} placeholder="The marketing copy for this material." />
      </div>
      <div>
        <label className={labelClass} htmlFor="m-claim">Claim</label>
        <input id="m-claim" type="text" value={claim} onChange={(e) => setClaim(e.target.value)} className={inputClass} placeholder="The central claim this material makes." />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="m-channel">Channel</label>
          <input id="m-channel" type="text" value={channel} onChange={(e) => setChannel(e.target.value)} className={inputClass} />
        </div>
        <div>
          <span className={labelClass}>Markets</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {MARKET_OPTIONS.map((market) => (
              <label key={market} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 shadow-sm">
                <input type="checkbox" checked={markets.includes(market)} onChange={() => toggleMarket(market)} className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400" />
                {market}
              </label>
            ))}
          </div>
        </div>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex items-center gap-2">
        <button type="submit" disabled={saving || uploading} className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50">
          {saving ? 'Adding.' : 'Add material'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:bg-slate-50">
          Cancel
        </button>
      </div>
    </form>
  );
}
