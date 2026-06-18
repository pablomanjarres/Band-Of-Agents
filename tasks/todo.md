# Dashboard as a live mirror of band.ai

Sequencing chosen by user: Stage A first, then Stage B.

## Stage A: clarity + honesty (now)
- [ ] Remove the stub-review buttons (Run review / Re-run review / Review this ad) from CampaignDetailPage
- [ ] Stop the in-UI fake review (POST /api/reviews) trigger; give LIVE PROCESSING + matrix honest empty states (no fake greens)
- [ ] MaterialDetail: replace "PER-REGION VALIDATION not validated" with the REAL band.ai verdict (material.review: decision pill + report link + summary); honest "not yet reviewed" empty state
- [ ] Campaign header badge derived from real verdicts (worst-case of material.review), not the fake rollup
- [ ] AddMaterialForm: plain-language labels + tooltips on every field (NAME, KIND, COPY, CLAIM, CHANNEL, MARKETS)
- [ ] Upload box: confirm "uploaded" only; move the transcription/frames copy out
- [ ] Cross-app guidance: "Reviews run in band.ai. Open the room and @Conductor to review this advertisement." (+ link to the band.ai room)
- [ ] Verify: web typecheck + build, deploy (push main), visual check on the deployed app

## Stage B: live run mirror (next)
- [ ] Backend: runs store + POST /api/runs, POST /api/runs/:id/events, SSE GET /api/runs/:id/events (reuse the existing BoardEvent + SSE infra)
- [ ] Agents: forward lifecycle events (received, transcript, frames/vision, pod reviewing, report ready, awaiting-decision, decided, new-material) to the backend run
- [ ] UI: LIVE PROCESSING panel becomes the live run timeline; a Runs list; agent-created images render as proposals; decision reflected back
- [ ] Verify end to end against a real band.ai review

## Notes
- The fake review = stub models returning zero findings -> reconciler auto-stamps every region "publish" (src/run/demo-fixtures.ts + src/agents/reconcile.ts decideRegion). Removing the trigger is safe.
- Real verdicts already persist on material.review via POST /api/materials/:id/review (written by the band.ai Adjudicator's recordVerdict).
- Do NOT delete PerceptionPanel / matrix / board reducer: Stage B repurposes them for the live run feed.
