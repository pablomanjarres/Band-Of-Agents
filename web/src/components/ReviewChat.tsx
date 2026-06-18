import { useEffect, useRef, useState } from 'react';
import { createRoom, postRoomMessage, subscribeToRoomEvents, type EventSubscription, type RoomMessage } from '../api';

interface ReviewChatProps {
  campaignId: string;
  advertisementId?: string;
  campaignName: string;
  advertisementName?: string;
  onClose: () => void;
}

type Phase = 'creating' | 'ready' | 'error';

interface ChatLine extends RoomMessage {
  /** A locally-echoed judge message awaiting its band.ai confirmation. */
  pending?: boolean;
}

/** A judge/intake message (our own post) renders on the right; agents on the left. */
function isOurs(line: ChatLine): boolean {
  return line.pending === true || line.senderType?.toLowerCase() === 'user';
}

/**
 * The judge's chat with the band.ai agents. Our server creates a real room, adds the
 * Conductor, posts on our behalf, and streams replies back, so a judge can drive the
 * whole review from here without ever logging in to band.ai.
 */
export function ReviewChat({ campaignId, advertisementId, campaignName, advertisementName, onClose }: ReviewChatProps) {
  const [phase, setPhase] = useState<Phase>('creating');
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const roomIdRef = useRef<string | null>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  // Create the room + open the live stream once, on mount.
  useEffect(() => {
    let sub: EventSubscription | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { roomId } = await createRoom({ campaignId, ...(advertisementId ? { advertisementId } : {}) });
        if (cancelled) return;
        roomIdRef.current = roomId;
        setPhase('ready');
        sub = subscribeToRoomEvents(roomId, (m) => {
          setLines((prev) => mergeMessage(prev, m, seenIds.current));
        });
      } catch (err) {
        if (cancelled) return;
        setPhase('error');
        setError(err instanceof Error ? err.message : 'Could not start the chat.');
      }
    })();
    return () => {
      cancelled = true;
      sub?.close();
    };
  }, [campaignId, advertisementId]);

  // Keep the latest message in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [lines]);

  async function send() {
    const text = input.trim();
    const roomId = roomIdRef.current;
    if (!text || !roomId || sending) return;
    setSending(true);
    setError(null);
    // Optimistic echo (band.ai's copy of our post arrives over SSE shortly after).
    const localId = `local-${Date.now()}`;
    setLines((prev) => [...prev, { id: localId, senderId: 'you', senderName: 'You', senderType: 'user', content: text, ts: Date.now(), pending: true }]);
    setInput('');
    try {
      await postRoomMessage(roomId, text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the message.');
      setLines((prev) => prev.filter((l) => l.id !== localId)); // roll back the optimistic line
    } finally {
      setSending(false);
    }
  }

  const scope = advertisementName ? `${campaignName} · ${advertisementName}` : campaignName;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-bg/60 backdrop-blur-sm" />
      <aside className="relative z-10 flex h-full w-full max-w-xl flex-col border-l border-border bg-surface shadow-2xl">
        <header className="glass sticky top-0 flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="eyebrow text-accent/80">Review chat · live with the agents</p>
            <h2 className="truncate font-display text-xl text-fg">{scope}</h2>
            <p className="mt-0.5 font-mono text-[11px] text-faint">
              {phase === 'creating' ? 'Starting the room…' : phase === 'error' ? 'Not connected' : 'Connected to band.ai'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost shrink-0 px-2.5 py-1 text-xs">Close</button>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-5">
          {phase === 'creating' ? (
            <p className="inline-flex items-center gap-1.5 text-xs text-muted">
              <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent" />
              Opening a band.ai room and bringing in the Conductor…
            </p>
          ) : null}

          {phase === 'error' ? (
            <div className="rounded-xl border border-danger/30 bg-danger/[0.06] p-3 text-sm text-danger">
              {error ?? 'Could not start the chat.'}
            </div>
          ) : null}

          {lines.map((line) => (
            <div key={line.id} className={`flex ${isOurs(line) ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${isOurs(line) ? 'bg-accent/15 text-fg' : 'surface text-fg/90'}`}>
                {!isOurs(line) ? <p className="mb-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-violet-300/80">{line.senderName}</p> : null}
                <p className="whitespace-pre-wrap">{line.content}</p>
              </div>
            </div>
          ))}

          {phase === 'ready' && lines.every((l) => isOurs(l)) && lines.length > 0 ? (
            <p className="inline-flex items-center gap-1.5 text-xs text-muted">
              <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-violet-400" />
              The Conductor is reviewing… replies appear here.
            </p>
          ) : null}
        </div>

        <div className="border-t border-border px-5 py-4">
          {error && phase === 'ready' ? <p className="mb-2 text-xs text-danger">{error}</p> : null}
          <form
            onSubmit={(e) => { e.preventDefault(); void send(); }}
            className="flex items-end gap-2"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
              rows={1}
              disabled={phase !== 'ready'}
              placeholder={phase === 'ready' ? 'Message the agents (e.g. "tighten the LATAM claim")…' : 'Connecting…'}
              className="min-h-[40px] flex-1 resize-none rounded-xl border border-border-strong bg-bg-soft/70 p-2.5 text-sm text-fg placeholder:text-faint focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-60"
            />
            <button type="submit" disabled={phase !== 'ready' || sending || !input.trim()} className="btn btn-primary px-4 py-2 text-sm">
              {sending ? 'Sending…' : 'Send'}
            </button>
          </form>
        </div>
      </aside>
    </div>
  );
}

/**
 * Merge an incoming room message into the list: dedup by id, and reconcile our own
 * optimistic echo (a pending 'user' line) with band.ai's confirmed copy of it.
 */
function mergeMessage(prev: ChatLine[], m: RoomMessage, seen: Set<string>): ChatLine[] {
  if (m.id && seen.has(m.id)) return prev;
  if (m.id) seen.add(m.id);
  // Our own post coming back from band.ai: replace the matching pending echo.
  if (m.senderType?.toLowerCase() === 'user') {
    const idx = prev.findIndex((l) => l.pending && l.content === m.content);
    if (idx >= 0) {
      const next = prev.slice();
      next[idx] = { ...m };
      return next;
    }
  }
  return [...prev, { ...m }];
}
