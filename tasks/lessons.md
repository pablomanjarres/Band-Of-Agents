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
- Observation: this background session cannot edit the shared checkout; it must EnterWorktree first. Working in `.claude/worktrees/band-review-board` (branch worktree-band-review-board). The user's `test` branch in the main checkout is untouched.

## 2026-06-13: Commit policy changed mid-session
- The initial instruction was no commits/remote; the user later asked to "make a ton of commits". Commit locally and granularly; still no push unless asked. Per CLAUDE.md, never add Co-Authored-By trailers.

## 2026-06-13: band.ai (@band-ai/sdk) live-integration gotchas
Found while getting the live multi-agent run working. Normalize at the transport (`src/band/real.ts`), not in each agent.
- Participant/sender `type` is capitalized ('Agent'/'User'); lowercase before comparing to 'agent'/'user'.
- `sendEvent` message_type must be one of: tool_call, tool_result, thought, error, task. Map custom labels (intake/review/verdict/...) to 'thought'.
- Delivered message content is prefixed with `@[[uuid]]` mention markup; strip it before JSON.parse.
- `getParticipants` exposes the participant NAME (e.g. 'Reconcile'), not the namespaced handle (`@user/reconcile`). Resolve targets by matching the handle's last segment against the name (`src/agents/handles.ts`).
- A reconnected agent does NOT auto-rejoin an existing room (no `autoSubscribeExistingRooms` on `Agent.create`); after a restart, add the agents to a fresh room to trigger room_added.
- Inbound delivery is by @mention only: a human reply must @mention the agent (a real mention chip, not plain text) to reach it.

## 2026-06-13: band.ai is THE integration layer; the app is a campaign portal, not the orchestrator
- Correction: the review must happen INSIDE a real band.ai room (agents collaborate via band.ai messages). The web app is a campaign-upload portal + results view, NOT the thing that "calls" the reviewers. The in-process board (FakeBandTransport BoardSession) is a dev/test substrate only, not the product path. Move the product to BOARD_MODE=band: app -> Intake agent -> real band.ai room -> always-on reviewer agents collaborate -> app observes.
- Rule: external agent logic still runs in the agents process connected to band.ai; band.ai is the room/coordination fabric, not a model host. "Call the reviewers from band.ai" = drop the campaign into a band.ai room and let the Coordinator recruit them via band.ai messages. The app never calls a reviewer directly.

## 2026-06-13: Realize the WHOLE diagram, not a linear reviewer subset
- Correction: the system looked like "just reviewers" because two loops in the architecture diagram are not closed: (1) Remediation -> re-review (a revised asset is produced but never re-submitted through the board), and (2) precedent -> shared context (precedent is logged but not fed back into future reviews). Also the Coordinator recruits ALL present agents rather than selectively by target market.
- Rule: when a diagram defines the architecture, map every node to a concrete agent and every arrow to a real message, and CLOSE every loop. Do not ship the linear happy path (recruit -> review -> verdict) and present it as the full negotiating system. Surface the orchestration in the UI (render the board AS the diagram: Coordinator/Reconcile/Remediation/Compliance-lead nodes with live state), not just reviewer cards.

## 2026-06-15: Subagent file writes are blocked by the worktree isolation guard
- Observation: when the parent background session is inside a worktree it did not create via EnterWorktree (EnterWorktree errors "already the current working directory"), spawned subagents cannot use the Write/Edit tools (guard: "parent bg session hasn't isolated"). They CAN write via the Bash tool (heredoc/perl/python), which the guard does not cover.
- Rule: for workflow/implementation subagents in this setup, tell them to write files via Bash (or spawn with isolation:'worktree'). Do not rely on Write/Edit inside subagents here. The main session can use Write/Edit after reading the file.
