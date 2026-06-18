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

### Slice 2: agents forward lifecycle to a run (next)
- [ ] run/agents.ts: openRun (POST /api/runs) + recordRunEvent (POST /api/runs/:id/events) against BACKEND
- [ ] Wire emit points: requested (Conductor), perceiving/transcript, pods reviewing, report (Adjudicator), awaiting-decision, decided, new material (Remediation image/copy)
- [ ] Unit-test the wiring (a fake poster captures the run events)

### Slice 3: UI live run timeline (next)
- [ ] api.ts: getCampaignRuns, getRun, subscribeToRun (SSE)
- [ ] LIVE PROCESSING panel becomes the live run timeline; a Runs list; new-material proposals render
- [ ] web build clean

### Deploy + verify end to end
- [ ] Redeploy backend (runs endpoints) + push frontend + restart agents
- [ ] Drive a real band.ai review -> run appears live in the dashboard with new material

## Notes
- Runs are in-memory (like campaignReviews). Durable "this was reviewed" is material.review (GCS). For a single Cloud Run instance this is fine; if it scales, pin max-instances=1 or persist runs.
- The backend POST /api/reviews stub path still exists (now unused by the UI); its tests are the load-sensitive ones. Candidate for later removal.
