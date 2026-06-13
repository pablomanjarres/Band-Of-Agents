# Todo: Multi-Region Marketing Compliance Review Board

Plan derived from `docs/superpowers/specs/2026-06-13-multi-region-review-board-design.md`.
Walking skeleton: prove each rung end to end (run it, show output) before the next.
Platform: band.ai. Stack: TypeScript, Node 22+, pnpm, ESM. No commits/remote (per user).

## Phase 0: Scaffolding -- DONE
- [x] pnpm + TypeScript ESM project (package.json, tsconfig, vitest, MIT LICENSE, README).
- [x] Domain types + zod schemas.
- [x] assets/: brand-dna.json, rulebook.us.json (6), rulebook.eu.json (7), rulebook.latam.json (illustrative), sample-asset.json (split claim).
- [x] ModelClient interface + StubModelClient.
- [x] BandTransport interface + FakeBandTransport + RealBandTransport.
- [x] .env.example.
- [x] Real model adapters: aiml.ts (openai SDK -> AIML + Nano Banana fetch), bedrock.ts, gemini.ts; route.ts (MODEL_MODE switch) with 429 retry.
- [x] docs/AIML_SWITCHOVER.md.

## MVP (rungs 1-5) -- DONE on the fake transport
- [x] Rung 1: agent replies only when @mentioned.
- [x] Rung 2: coordinator recruits + hands off; reviewer replies.
- [x] Rung 3: region reviewer produces structured findings on the asset.
- [x] Rung 4: full board; reconcile detects US-publish / EU-block conflict; per-region verdicts.
- [x] Rung 5: deadlock escalates to human; decision logged as precedent.
- [x] Full board incl. Brand reviewer (US/EU/Brand + Reconcile). `pnpm local` runs it. 10 tests green.

## Real integrations
- [x] Model layer (AIML main + Bedrock/Vertex dev), typechecked vs real SDKs.
- [x] RealBandTransport via @band-ai/sdk, typechecked.
- [x] Real runner `pnpm agents` wiring the 5 created agents (Coordinator/US/EU/Brand/Reconcile).
- [ ] LIVE RUN on band.ai. BLOCKED: API keys were truncated in the screenshots; need the full
      keys in .env, plus MODEL_MODE + AIML key (or AWS/GCP creds) for live model calls. Then
      smoke-test and capture the real-room transcript.
- [ ] LATAM region: drop-in once a band.ai LATAM agent exists (rulebook ready).

## Enhancements
- [ ] Remediation + Nano Banana: rewrite copy per region, regenerate localized image via AIML,
      re-submit (bidirectional loop). AIML prize + multimodal moment. (Next; buildable on fake.)
- [ ] Verify full-AIML mode end to end + smoke-test chat and Nano Banana.
- [ ] Cross-framework reviewer via TS LangGraphAdapter.
- [ ] Featherless open-model reviewer (Featherless prize).

## Final stretch
- [ ] Record the video (one continuous real run, hook in 10s, 2 to 3 min).
- [ ] Slides; clean public MIT repo with README + hosted demo URL.

## Review
- 2026-06-13: MVP (rungs 1-5) proven on the fake transport; the full debate (US/EU/Brand +
  Reconcile + human escalation + precedent) runs via `pnpm local`. Model layer (AIML main path +
  Bedrock/Vertex dev, one MODEL_MODE switch) and RealBandTransport both written and typechecked
  against the real SDKs. 10 vitest tests pass, `tsc --noEmit` clean. Blocked only on the full
  band.ai agent API keys for the live run.
