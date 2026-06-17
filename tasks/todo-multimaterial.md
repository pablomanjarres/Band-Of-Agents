# Task: multi-material review (review an advertisement's materials one by one)

Goal: "@Conductor review the <campaign> [advertisement]" reviews EACH material in turn
until all of the advertisement's materials have been reviewed.

## Design (sequential, one band.ai room)
- Conductor holds a per-room QUEUE of materials. On a human post it resolves the
  campaign/advertisement to its material list and reviews material[0].
- Each material runs the full pods cycle (review -> permission gate -> verdict).
- The Adjudicator notifies the Conductor on each terminal; the Conductor advances to
  the next material, resetting per-material state, until the queue is empty, then posts
  a campaign-complete summary.
- Single asset = a queue of length 1 (unchanged behaviour).

## Steps
- [ ] pod-hub: resetReview(roomId) to clear per-material state between materials
- [ ] pod-remediation: prefer hub.asset over the cached asset (no stale material)
- [ ] conductor: queue + advance-on-adjudicator-done + lookupMaterials resolver
- [ ] risk-adjudicator: notify the conductor on each terminal (published/spiked)
- [ ] pod-board: thread lookupMaterials + the conductor notify handle
- [ ] agents: lookupMaterials resolves a campaign/ad to its materials from the backend
- [ ] tests green (171) + a multi-material e2e test; stub-sim verify; restart; push
