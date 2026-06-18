// Forwards a band.ai review's lifecycle to the backend run mirror (Stage B), so the
// dashboard shows the workflow live. Pure + injectable (fetch is a dep) so the verdict
// -> beat + completion logic is unit-tested without connecting to band.ai. Every call
// is best-effort: a forwarding failure must never throw into the review path.

type FetchFn = (input: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface RunForwarderDeps {
  backend: string;
  fetchFn?: FetchFn;
  warn?: (msg: string) => void;
}

export interface RunOpen {
  campaignId: string;
  advertisementId?: string;
  label: string;
  total: number;
}

export interface RunBeat {
  stage: 'requested' | 'perceiving' | 'reviewing' | 'report' | 'awaiting-decision' | 'decided' | 'material' | 'log';
  message: string;
  agent?: string;
  materialId?: string;
  artifact?: { kind: 'image' | 'report'; url: string; title?: string };
  status?: 'running' | 'awaiting-decision' | 'complete' | 'error';
}

export interface VerdictInput {
  materialId: string;
  decision: 'published' | 'spiked' | 'escalated';
  reportUrl?: string;
  summary?: string;
}

export interface RunForwarder {
  openRun: (input: RunOpen) => Promise<void>;
  emit: (beat: RunBeat) => Promise<void>;
  onVerdict: (input: VerdictInput) => Promise<void>;
  onMaterial: (url: string, opts?: { title?: string; message?: string }) => Promise<void>;
  readonly runId: string | undefined;
}

export function makeRunForwarder(deps: RunForwarderDeps): RunForwarder {
  const f: FetchFn = deps.fetchFn ?? ((input, init) => fetch(input, init));
  const warn = deps.warn ?? (() => {});
  // One run per review request. doneIds tracks materials that reached a FINAL verdict
  // (published/spiked); when all are in, the run completes. An escalation parks it in
  // awaiting-decision until the human rules (which lands a final verdict later).
  let current: { id: string; total: number; doneIds: Set<string>; escalated: boolean } | undefined;

  async function openRun(input: RunOpen): Promise<void> {
    try {
      const res = await f(`${deps.backend}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          campaignId: input.campaignId,
          ...(input.advertisementId ? { advertisementId: input.advertisementId } : {}),
          label: input.label,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { id } = (await res.json()) as { id: string };
      current = { id, total: Math.max(1, input.total), doneIds: new Set(), escalated: false };
    } catch (err) {
      warn(`open failed: ${(err as Error)?.message ?? String(err)}`);
      current = undefined;
    }
  }

  async function emit(beat: RunBeat): Promise<void> {
    const run = current;
    if (!run) return;
    try {
      await f(`${deps.backend}/api/runs/${run.id}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(beat),
      });
    } catch (err) {
      warn(`event failed: ${(err as Error)?.message ?? String(err)}`);
    }
  }

  async function onVerdict(input: VerdictInput): Promise<void> {
    const run = current;
    const isEscalation = input.decision === 'escalated';
    let status: RunBeat['status'];
    if (run) {
      if (isEscalation) {
        run.escalated = true;
        status = 'awaiting-decision';
      } else {
        run.doneIds.add(input.materialId);
        if (run.doneIds.size >= run.total) status = 'complete';
      }
    }
    const verb = input.decision === 'published' ? 'PUBLISHED' : input.decision === 'spiked' ? 'SPIKED' : 'needs your decision';
    await emit({
      stage: isEscalation ? 'awaiting-decision' : 'report',
      agent: 'Risk Adjudicator',
      message: input.summary ?? `Verdict for ${input.materialId}: ${verb}`,
      materialId: input.materialId,
      ...(input.reportUrl ? { artifact: { kind: 'report' as const, url: input.reportUrl, title: 'View full report' } } : {}),
      ...(status ? { status } : {}),
    });
  }

  async function onMaterial(url: string, opts?: { title?: string; message?: string }): Promise<void> {
    if (!url) return;
    await emit({
      stage: 'material',
      agent: 'Remediation',
      message: opts?.message ?? 'Generated a new material (rewritten copy + image).',
      artifact: { kind: 'image', url, title: opts?.title ?? 'New material proposed' },
    });
  }

  return {
    openRun,
    emit,
    onVerdict,
    onMaterial,
    get runId() {
      return current?.id;
    },
  };
}
