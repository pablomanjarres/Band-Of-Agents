import { useState } from 'react';
import { addMaterial, getCampaign, uploadImage, uploadVideo } from '../api';
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

const labelClass = 'block font-mono text-[10px] font-medium uppercase tracking-wider text-faint';
const hintClass = 'mt-0.5 text-[11px] leading-tight text-muted/80';
const inputClass =
  'mt-1.5 w-full rounded-xl border border-border-strong bg-bg-soft/70 p-2 text-sm text-fg placeholder:text-faint transition-colors focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/25';

export function AddMaterialForm({ campaign, advertisementId, defaultMarkets, onAdded, onCancel }: AddMaterialFormProps) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<MaterialKind>('video');
  const [channel, setChannel] = useState('instagram');
  const [copy, setCopy] = useState('');
  const [claim, setClaim] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  // Held so we can re-post the same bytes with the new materialId after the material
  // is created, which is what triggers the server's upload-time transcription.
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  // 'transcribing' while the just-added video is being transcribed; the result then
  // reflects whether a transcript was captured.
  const [transcribing, setTranscribing] = useState(false);
  const [markets, setMarkets] = useState<string[]>(defaultMarkets);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleMarket(market: string) {
    setMarkets((prev) => (prev.includes(market) ? prev.filter((m) => m !== market) : [...prev, market]));
  }

  async function handleVideo(file: File) {
    setUploading(true);
    setUploadPct(0);
    setError(null);
    try {
      const res = await uploadVideo(file, {
        campaignId: campaign.id,
        advertisementId,
        onProgress: (f) => setUploadPct(Math.round(f * 100)),
      });
      setVideoUrl(res.videoUrl);
      setVideoFile(file);
      setUploadName(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload the video.');
    } finally {
      setUploading(false);
      setUploadPct(null);
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

      // For a freshly added video, transcribe now: the material did not exist when
      // the file was uploaded, so the server could not attach a transcript yet. Re-post
      // the held bytes with the new materialId to run the (graceful) upload-time STT,
      // then re-read the campaign so the material carries perception.transcript. Any
      // transcription failure is non-fatal: the material is already added.
      let finalCampaign = res.campaign;
      if (kind === 'video' && videoFile && res.material.id) {
        setTranscribing(true);
        try {
          await uploadVideo(videoFile, {
            campaignId: campaign.id,
            advertisementId,
            materialId: res.material.id,
          });
          const refreshed = await getCampaign(campaign.id);
          finalCampaign = refreshed.campaign;
        } catch {
          // Keep the material; the transcript can still be produced on the next review
          // or via the manual Transcribe button on the material detail.
        } finally {
          setTranscribing(false);
        }
      }
      onAdded(finalCampaign);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add material.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="surface space-y-3 rounded-2xl p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="m-name">Name</label>
          <p className={hintClass}>A short label for this asset, for your reference.</p>
          <input id="m-name" type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="e.g. Hero spot" />
        </div>
        <div>
          <label className={labelClass} htmlFor="m-kind">Kind</label>
          <p className={hintClass}>What this asset is: video, post, image, or banner.</p>
          <select id="m-kind" value={kind} onChange={(e) => setKind(e.target.value as MaterialKind)} className={inputClass}>
            {MATERIAL_KINDS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
      </div>

      {/* Real upload: video for video kinds, image for image/banner kinds. */}
      {kind === 'video' ? (
        <Dropzone accent="violet" accept="video/*" label="Drop a video, or click to choose" hint="MP4 or MOV" busy={uploading} doneName={uploadName} onFile={handleVideo} />
      ) : (
        <Dropzone accent="teal" accept="image/*" label="Drop an image, or click to choose" hint="PNG or JPG" busy={uploading} doneName={uploadName} onFile={handleImage} />
      )}

      {uploading && uploadPct !== null ? (
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-accent transition-all duration-200" style={{ width: `${uploadPct}%` }} />
          </div>
          <span className="font-mono text-[11px] text-faint">Uploading {uploadPct}%</span>
        </div>
      ) : null}

      <div>
        <label className={labelClass} htmlFor="m-copy">Copy</label>
        <p className={hintClass}>The full marketing text the audience reads (the caption or script).</p>
        <textarea id="m-copy" value={copy} onChange={(e) => setCopy(e.target.value)} rows={3} className={inputClass} placeholder="e.g. 15 seconds to feeling your best. Immune+ supports everyday wellness as part of a balanced diet." />
      </div>
      <div>
        <label className={labelClass} htmlFor="m-claim">Claim</label>
        <p className={hintClass}>The specific benefit claim the agents fact-check, e.g. "clinically proven to boost immunity".</p>
        <input id="m-claim" type="text" value={claim} onChange={(e) => setClaim(e.target.value)} className={inputClass} placeholder="e.g. Supports everyday immune health." />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="m-channel">Channel</label>
          <p className={hintClass}>Where it runs: instagram, tiktok, youtube, and so on.</p>
          <input id="m-channel" type="text" value={channel} onChange={(e) => setChannel(e.target.value)} className={inputClass} />
        </div>
        <div>
          <span className={labelClass}>Markets</span>
          <p className={hintClass}>Regions to validate against. Each market has its own ad rules.</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {MARKET_OPTIONS.map((market) => {
              const checked = markets.includes(market);
              return (
                <label
                  key={market}
                  className={[
                    'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all',
                    checked
                      ? 'border-accent/50 bg-accent/10 text-accent'
                      : 'border-border-strong bg-bg-soft/60 text-muted hover:text-fg',
                  ].join(' ')}
                >
                  <input type="checkbox" checked={checked} onChange={() => toggleMarket(market)} className="h-3.5 w-3.5 rounded border-border-strong bg-bg-soft text-accent-strong focus:ring-accent/40 focus:ring-offset-0" />
                  {market}
                </label>
              );
            })}
          </div>
        </div>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="flex items-center gap-2">
        <button type="submit" disabled={saving || uploading || transcribing} className="btn btn-primary">
          {transcribing ? 'Transcribing…' : saving ? 'Adding…' : 'Add material'}
        </button>
        <button type="button" onClick={onCancel} disabled={transcribing} className="btn btn-ghost px-4 py-2">
          Cancel
        </button>
        {transcribing ? (
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-faint">
            <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent" />
            Transcribing the video…
          </span>
        ) : null}
      </div>
    </form>
  );
}
