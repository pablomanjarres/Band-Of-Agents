import { useRef, useState } from 'react';

interface DropzoneProps {
  /** Accept attribute, e.g. 'video/*', 'image/*', '.md,.json,.txt'. */
  accept: string;
  label: string;
  hint?: string;
  busy?: boolean;
  /** Called with the chosen/dropped file (click or drag-and-drop). */
  onFile: (file: File) => void | Promise<void>;
  accent?: Accent;
  /** Name of the last successfully handled file, shown as a confirmation. */
  doneName?: string | null;
  compact?: boolean;
}

type Accent = 'violet' | 'indigo' | 'teal' | 'slate';

// Static class strings per accent (Tailwind cannot see dynamically built names).
const ACCENT: Record<Accent, { idle: string; over: string; icon: string }> = {
  violet: { idle: 'border-violet-300 hover:border-violet-400 hover:bg-violet-50/60', over: 'border-violet-500 bg-violet-50 ring-2 ring-violet-300', icon: 'text-violet-500' },
  indigo: { idle: 'border-indigo-300 hover:border-indigo-400 hover:bg-indigo-50/60', over: 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-300', icon: 'text-indigo-500' },
  teal: { idle: 'border-teal-300 hover:border-teal-400 hover:bg-teal-50/60', over: 'border-teal-500 bg-teal-50 ring-2 ring-teal-300', icon: 'text-teal-500' },
  slate: { idle: 'border-slate-300 hover:border-slate-400 hover:bg-slate-50', over: 'border-slate-500 bg-slate-100 ring-2 ring-slate-300', icon: 'text-slate-500' },
};

/**
 * A real drag-and-drop file dropzone (also click-to-pick). It surfaces the upload
 * prominently and works for video, images, and .md/.json rulebooks/sources: the
 * parent gets the File via onFile and decides what to do (upload, read as text).
 */
export function Dropzone({ accept, label, hint, busy, onFile, accent = 'indigo', doneName, compact }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const tone = ACCENT[accent];

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) void onFile(file);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !busy && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !busy) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!over) setOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!busy) handleFiles(e.dataTransfer.files);
      }}
      className={`flex w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-center transition ${
        compact ? 'gap-1 px-3 py-3' : 'gap-1.5 px-4 py-6'
      } ${over ? tone.over : tone.idle} ${busy ? 'cursor-wait opacity-70' : ''}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        disabled={busy}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <svg className={`h-6 w-6 ${tone.icon}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 16V4m0 0L8 8m4-4 4 4" />
        <path d="M20 16.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1.5" />
      </svg>
      <span className="text-sm font-semibold text-slate-700">
        {busy ? 'Uploading.' : doneName ? `${doneName} uploaded` : label}
      </span>
      {hint && !busy ? <span className="text-xs text-slate-400">{hint}</span> : null}
      {doneName && !busy ? (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> ready
        </span>
      ) : null}
    </div>
  );
}
