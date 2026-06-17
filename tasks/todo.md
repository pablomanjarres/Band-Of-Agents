# Task: permission-gated remediation workflow + flagged demo campaign

## Plan / progress
- [x] Seed persistent flagged campaign (VitaBoost Focus Q3) in data/assets.json
- [x] Verify it parses + Conductor resolves "VitaBoost Focus"
- [x] Risk Adjudicator: gate remediation on HUMAN PERMISSION; trigger on BLOCK findings
      (solo pods produce blocks, not conflicts), not only cross-pod conflicts
- [x] Risk Adjudicator: richer publish message (no silent "0 findings")
- [x] Remediation: rewrite ALL blocked spans; POST rewritten copy + image link visibly
- [x] Agents runner: self-serve generated promo images (HTTP :8788); wire hostImage
- [x] Tests: rewrote adjudicator Test B + 2 new; full suite 168 pass; typecheck clean
- [x] Restart live agents (vertex): 10 agents connected, image server bound :8788
- [~] Real-model verification on VitaBoost (Claims reviewer flagged 3 findings)
- [ ] Update docs (LIVE_BAND.md flow + HowItWorks) for the permission-gate beat
- [ ] Give the user the band.ai steps

## Review
(fill after verification)

## Review (done)
- VitaBoost Focus Q3 seeded (persistent in data/assets.json); Conductor resolves "VitaBoost Focus".
- Risk Adjudicator now gates remediation on human permission, triggers on BLOCK findings
  (not only conflicts), publishes with a summary, escalates only a post-fix deadlock.
- Remediation rewrites all blocked spans and posts the rewritten copy + a clickable image link.
- Agents runner self-serves generated images on :8788; hostImage wired.
- Tests: 168 pass (typecheck clean). Docs updated (LIVE_BAND, HowItWorks, README, ARCHITECTURE).
- Live proof (real Vertex): Claims reviewer returns 3 BLOCKS on VitaBoost
  ("clinically proven...", "9 out of 10 users...", "Doctor recommended") -> gate fires.
  Image gen -> hosted PNG served HTTP 200. Live cast: 10 agents connected, image server up.
- Note: regulatory pod is slow ONLY in the single-threaded fake-transport sim (sequential
  gemini-2.5-pro); live agents review concurrently. pod-lead/pod-region-reviewer unchanged.
