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
  violet: { idle: 'border-violet-400/30 hover:border-violet-400/60 hover:bg-violet-500/[0.06]', over: 'border-violet-400/70 bg-violet-500/10 ring-2 ring-violet-400/40', icon: 'text-violet-300' },
  indigo: { idle: 'border-accent/30 hover:border-accent/60 hover:bg-accent/[0.06]', over: 'border-accent/70 bg-accent/10 ring-2 ring-accent/40', icon: 'text-accent' },
  teal: { idle: 'border-teal-400/30 hover:border-teal-400/60 hover:bg-teal-500/[0.06]', over: 'border-teal-400/70 bg-teal-500/10 ring-2 ring-teal-400/40', icon: 'text-teal-300' },
  slate: { idle: 'border-border-strong hover:border-border-strong hover:bg-surface-3/60', over: 'border-muted/60 bg-surface-3 ring-2 ring-border-strong', icon: 'text-muted' },
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
      <span className="text-sm font-semibold text-fg">
        {busy ? 'Uploading…' : doneName ? `${doneName} uploaded` : label}
      </span>
      {hint && !busy && !doneName ? <span className="text-xs text-faint">{hint}</span> : null}
      {doneName && !busy ? (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-human">
          <span className="h-1.5 w-1.5 rounded-full bg-human" /> uploaded
        </span>
      ) : null}
    </div>
  );
}
