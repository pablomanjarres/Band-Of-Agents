# Task: market-tailored versions when regulations collide (fork-on-irreconcilable)

User decisions (AskUserQuestion):
- Fork into per-market versions ONLY when no single shared version is possible.
- Ask the human first (permission gate) before producing the per-market versions.

## Plan
- [ ] Hub: add splitPlan (Adjudicator -> Remediation) + splitVersions (Remediation -> Adjudicator)
- [ ] Adjudicator: detect a cross-market collision = unresolved conflict with
      blockedBy AND passedBy non-empty (some market bans, another allows). On that:
      pendingAction='split', ask "ship market-tailored versions, or reject?"
- [ ] Adjudicator: on "yes" build a per-market plan (each blocking market's spans +
      universal blocks), stash on hub, ask Remediation to produce versions
- [ ] Remediation: split branch -> rewrite copy + regenerate image PER blocking market,
      post each version (copy + image link), report versions back to the Adjudicator
- [ ] Adjudicator: on versions ready -> terminal PER MARKET (US/EU/LATAM published,
      passing markets ship original). Single-fix path (no cross-market conflict) unchanged.
- [ ] Seed a collision campaign: substantiated "clinically proven" claim (US passes w/
      disclosure, EU bans). So the split path reliably fires.
- [ ] Tests: split path (US passes/EU blocks -> ask split -> yes -> per-market versions ->
      per-market published); keep fix path + pod-board/pod-session green
- [ ] typecheck + test green
- [ ] Restart agents; verify with real Vertex (collision -> split -> 3 versions + image links)
- [ ] Docs: LIVE_BAND / HowItWorks / ARCHITECTURE note the split outcome

## Review
(fill after)

## Review (done)
- Final REPORT (src/agents/review-report.ts): the Adjudicator posts one self-contained
  message - verdict, every flagged claim grouped by reviewer with ruleId + reason +
  required disclosure, the fixes, and material links - both as the permission ask AND as
  the LAST word at every terminal (so it cannot get buried). Snapshot of original findings
  kept so the verdict shows what was wrong even after a fix clears the re-review.
- Market SPLIT: cross-market collision (a span one market bans, another allows) -> the ask
  offers per-market versions; on "yes" Remediation produces one tailored version per
  blocking market (copy + image), passing markets ship the original, and the campaign
  publishes PER-MARKET. Hub gained splitPlan/splitVersions; Remediation a split branch;
  Adjudicator buildSplitPlan/triggerSplit/finalizeSplit.
- Seeded NeuroPeak Q3 (substantiated "clinically proven" claim) so US passes / EU+LATAM
  ban -> a clean split demo. VitaBoost stays for the all-block path.
- Tests: 171 pass (added review-report.test.ts + pod-split.test.ts); typecheck clean.
- Live agents restarted (vertex, 10 agents, image server :8788) with report + split code.
- Docs updated: LIVE_BAND, ARCHITECTURE, HowItWorks.
