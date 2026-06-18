import { useEffect, useRef, useState } from 'react';
import { deleteRun, getCampaignRuns, getRun, subscribeToRun } from './api';
import type { EventSubscription } from './api';
import type { Run, RunEvent, RunSummary } from './types';

export interface RunFeed {
  runs: RunSummary[];
  activeRun: Run | undefined;
  selectRun: (id: string) => void;
  removeRun: (id: string) => Promise<void>;
}

// Mirrors the band.ai runs for a campaign: polls the run list (so a review started
// in band.ai shows up within a few seconds) and live-subscribes to the active run's
// SSE so each lifecycle beat lands on the dashboard. Auto-follows the newest run
// until the user pins an older one.
export function useRunFeed(campaignId: string | undefined): RunFeed {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activeRun, setActiveRun] = useState<Run | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const pinnedRef = useRef(false);
  const subRef = useRef<EventSubscription | null>(null);

  // Poll the campaign's runs; auto-follow the newest unless the user pinned one.
  // Also reconcile the active run's status (events carry no status; the summary does).
  useEffect(() => {
    if (!campaignId) return;
    let active = true;
    const tick = async (): Promise<void> => {
      try {
        const res = await getCampaignRuns(campaignId);
        if (!active) return;
        setRuns(res.runs);
        if (!pinnedRef.current && res.runs[0]) setSelectedId(res.runs[0].id);
        setActiveRun((prev) => {
          if (!prev) return prev;
          const summary = res.runs.find((r) => r.id === prev.id);
          return summary && summary.status !== prev.status ? { ...prev, status: summary.status } : prev;
        });
      } catch {
        // Best effort; the next tick retries.
      }
    };
    void tick();
    const interval = window.setInterval(() => void tick(), 4000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [campaignId]);

  // Subscribe to the selected run: load its timeline, then stream live beats.
  useEffect(() => {
    subRef.current?.close();
    subRef.current = null;
    if (!selectedId) {
      setActiveRun(undefined);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const res = await getRun(selectedId);
        if (!active) return;
        setActiveRun(res.run);
        subRef.current = subscribeToRun(selectedId, (event: RunEvent) => {
          setActiveRun((prev) => {
            if (!prev || prev.id !== selectedId) return prev;
            if (prev.events.some((e) => e.seq === event.seq)) return prev; // dedupe replay
            return { ...prev, events: [...prev.events, event], updatedAt: event.at };
          });
        });
      } catch {
        // Best effort; leave the previous active run in place.
      }
    })();
    return () => {
      active = false;
      subRef.current?.close();
      subRef.current = null;
    };
  }, [selectedId]);

  const selectRun = (id: string): void => {
    pinnedRef.current = true;
    setSelectedId(id);
  };

  const removeRun = async (id: string): Promise<void> => {
    try {
      await deleteRun(id);
    } catch {
      // Best effort; the optimistic removal below still tidies the UI.
    }
    setRuns((prev) => prev.filter((r) => r.id !== id));
    if (selectedId === id) {
      pinnedRef.current = false; // let the poll auto-follow the next newest run
      setSelectedId(undefined);
      setActiveRun(undefined);
    }
  };

  return { runs, activeRun, selectRun, removeRun };
}
