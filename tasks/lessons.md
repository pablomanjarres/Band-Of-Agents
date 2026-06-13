# Lessons

Patterns captured after corrections, so the same mistake does not recur.

## 2026-06-13: The platform is band.ai, not thenvoi
- Correction: the SDK and docs surface "thenvoi" branding, but this project's platform is band.ai. Use the `@band-ai/sdk` package name, app.band.ai for the web app, and band.ai branding in all code, docs, comments, and prompts. Agent API keys look like `band_a_...`.
- Rule: when a vendor has a legacy/alt brand (here: thenvoi == band.ai), default to the name the user uses (band.ai) everywhere user-facing, and only mention the alias once as a footnote if needed.

## 2026-06-13: Model set is constrained to what ../noelle uses (no Opus 4.8)
- Correction: do not assume the newest models exist. Allowed set mirrors the sibling `noelle` project: Claude opus-4-6 / sonnet-4-6 / haiku-4-5 (Bedrock ids `us.anthropic.claude-*`), Gemini 2.5 pro/flash, GPT-5/mini. Opus 4.8 is NOT available.
- Rule: before picking model ids, check what the user's existing projects actually call; constrain to that set rather than the theoretical latest.

## 2026-06-13: AIML is the architectural main path, with a documented switch
- Requirement: AIML API must be the primary/default model provider; AWS (Bedrock) and GCP (Vertex) are dev-time cost-savers behind one switch (`MODEL_MODE`), with `docs/AIML_SWITCHOVER.md` describing how to remove every non-AIML path and run 100% on AIML.
- Rule: when a partner API is a prize target, make it the default route and the cost-savers an explicit, single-switch, documented override (not the other way around).

## 2026-06-13: Background jobs must isolate edits in a worktree
- Observation: this background session cannot edit the shared checkout; it must EnterWorktree first. Working in `.claude/worktrees/band-review-board` (branch worktree-band-review-board). No commits, no remote, per the user's constraint. The user's `test` branch in the main checkout is untouched.
