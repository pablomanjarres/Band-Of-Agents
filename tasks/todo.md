# Dashboard as a live mirror of band.ai

Sequencing chosen by user: Stage A first, then Stage B.

## Stage A: clarity + honesty (DONE, deployed)
- [x] Remove the stub-review buttons (Run review / Re-run review / Review this ad)
- [x] Stop the in-UI fake review trigger; honest empty states (no fake greens)
- [x] MaterialDetail: show the REAL band.ai verdict (decision pill + summary + report link)
- [x] Campaign header + ad tabs + worst-case derived from real verdicts
- [x] AddMaterialForm: plain-language hints on every field (copy vs claim) + examples
- [x] Upload box: confirm "uploaded" only
- [x] Cross-app guidance: "Reviews run in band.ai" + Review-in-band.ai button (copies @Conductor command)
- [x] Verified: web build clean; deployed; live build hash confirmed

## Stage B: live run mirror
### Slice 1: backend runs store (DONE, verified)
- [x] src/domain/runs.ts: Run / RunEvent / RunStage / schemas + toRunSummary
- [x] server: runs Map + appendRunEvent; POST /api/runs, POST /api/runs/:id/events, GET /api/runs/:id, GET /api/campaigns/:id/runs, SSE GET /api/runs/:id/events
- [x] test/runs.test.ts: 7 tests pass; src typecheck clean
- [x] Confirmed the 5 server-campaigns failures are pre-existing (load-driven timeouts), not from this change

### Slice 2: agents forward lifecycle to a run (DONE, typecheck clean)
- [x] src/run/run-forward.ts: pure, injectable forwarder (open/emit/onVerdict/onMaterial + completion tracking)
- [x] run/agents.ts: startRun at lookupMaterials resolve (requested + reviewing beats); wrap recordVerdict (report/decision beat + completion); wrap hostImage (new-material beat). All best-effort, never blocks the review.
- [x] test/run-forward.test.ts written (5 cases). NOTE: could not RUN it (machine out of RAM, vitest/tsx OOM-killed exit 194). typecheck validates it compiles.

### Slice 3: UI live run timeline (DONE, web build clean)
- [x] api.ts: getCampaignRuns, getRun, subscribeToRun (generic SSE)
- [x] runFeed.ts: useRunFeed (polls runs, auto-follows newest, live-subscribes)
- [x] RunTimeline.tsx: lifecycle beats with stage tones + image/report artifacts
- [x] CampaignDetailPage: LIVE PROCESSING panel = run timeline; recent-runs list; RunStatusDot
- [x] web build clean (index-B98Wm8KU.js)

### Deploy + verify end to end (PENDING - needs user)
- [ ] Free memory, then run the full suite (pnpm test) to confirm runs + forwarder tests
- [ ] Redeploy backend (runs endpoints) [needs gcloud auth] + push frontend to main + restart the cast
- [ ] Drive a real band.ai review -> run appears live in the dashboard with the new material

## Environmental blockers hit this session
- Machine out of RAM (70M unused, 10G compressed): node/vitest/tsx OOM-killed (exit 194, no output). tsc works. Tests un-runnable until memory frees. Not a code issue (Stage A baseline fails the same load-sensitive tests).
- Backend redeploy needs interactive gcloud auth (ADC was fixed earlier this session).

## Notes
- Runs are in-memory (like campaignReviews). Durable "this was reviewed" is material.review (GCS). For a single Cloud Run instance this is fine; if it scales, pin max-instances=1 or persist runs.
- The backend POST /api/reviews stub path still exists (now unused by the UI); its tests are the load-sensitive ones. Candidate for later removal.

---

# Review UI pass: left report column, inline images, yes/no decision, agent link (2026-06-18)

Target: deployed `main` (== origin/main, Vercel prod). All four are CONFIRMED missing from
deployed main (the other implementations live on unmerged branches).

- [x] 1. Report fills the LEFT column (not a right overlay) — ReviewChat de-overlaid to an in-flow
      `<aside>`; mounted as the left column of CampaignDetailPage's two-pane flex (sticky, bounded
      height, internal scroll); old overlay mount removed.
- [x] 2. Render the campaign images — exported `Markdown` from ArtifactViewerPage and use it for the
      feed body; `![campaign image](/api/images/..)` now renders as <img>.
- [x] 3. Yes/No on the verdict — Approve(`yes`)/Reject(`reject`) buttons wired to
      submitCampaignDecision(rid, materialId, decision).
- [x] 4. "The agents forgot the link" — pod-region-reviewer.ts + pod-lead.ts reworded (defer to the
      Adjudicator's linked report). NOTE: backend; needs a redeploy of the Band agents to show.

## Verify
- [x] web build clean (tsc -b && vite build) + backend tsc --noEmit clean
- [x] adversarial 3-lens review of the diff — caught + fixed:
  - CRITICAL: buttons gated on `phase==='done'` but an escalated review (the demo path, and the
    case in the screenshot) parks at `awaiting-decision` and never emits `complete`. Fixed: added an
    `awaiting` phase, gate buttons on it. Conceptually correct too (yes/no belongs on escalations).
  - MAJOR: resumed-from-history reviews never set activeMaterialId. Fixed: derive it from the SSE
    stream (`setActiveMaterialId(prev => prev ?? e.materialId)`).
  - (mine, found while verifying) dedup-key collision: awaiting-decision and the post-ruling
    complete both use seq 0 + no materialId, so the completion was dropped. Fixed: fold the status
    value into the dedup key.
  - MINOR (left as-is, by design): backend logs the ruling text but does not flip the verdict in the
    deterministic KEY_FREE_LOCAL mode; in real-LLM mode the Adjudicator acts on `yes`/`reject`
    (the literal words the agents' own prompt asks for).

## Deploy (pending user)
- Frontend: push to `main` -> Vercel auto-deploys artifact-viewer-one (this is a PROD change).
- Backend (only needed for ask #4 wording + decision endpoint): gcloud redeploy band-backend.
