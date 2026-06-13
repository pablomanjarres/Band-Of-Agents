# Band Review Board

A multi-region marketing-compliance review board built on [band.ai](https://band.ai) for the Band of Agents Hackathon. Specialist agents with competing mandates (US vs EU advertising rules, plus brand voice) review a marketing asset in a shared Band room, debate, reconcile to a per-region verdict (publish, adapt, or escalate), and escalate genuine deadlocks to a human. A remediation agent rewrites non-compliant copy and regenerates a localized image (Nano Banana), then sends it back into review.

The originality is the conflict: a claim that is fine in the US can be unlawful in the EU, so the reviewers genuinely disagree on the same asset and must negotiate. It is a negotiation, not a linear pipeline.

Compliance content here is a hackathon demo, NOT legal advice.

## How it works
- Each agent is a band.ai "External" agent and a first-class participant in the room. They coordinate by @mention.
- Shared context: a structured brand DNA plus a per-region rulebook for each market (`assets/`).
- The reviewers run on different models (multi-model by design): US/Brand/Reconcile on Claude, EU on Gemini, image work via Nano Banana.
- Human escalation decisions are recorded as precedent.

## Agents
Coordinator (recruits reviewers), US reviewer (FTC), EU reviewer (EU + GDPR), Brand reviewer (on-voice), Reconcile (per-region verdict + conflict detection + escalation), Remediation (rewrite + regenerate, re-review). A LATAM reviewer is a drop-in (rulebook is in `assets/rulebook.latam.json`).

## Stack
TypeScript, Node 22+, pnpm, ESM. Coordination via `@band-ai/sdk`. Models route through AI/ML API by default (`MODEL_MODE=aiml`); AWS Bedrock and GCP Vertex are dev-time cost-savers behind the same switch. See `docs/AIML_SWITCHOVER.md`.

## Develop
```
pnpm install
pnpm test         # fake-transport + routing tests, no keys needed
pnpm typecheck
pnpm local        # full debate end to end on the in-process fake transport (no keys)
```

## Run on real band.ai
1. Create the agents in app.band.ai (one per role) and put their IDs + API keys in `.env` (copy `.env.example`).
2. Choose a model provider: set `AIML_API_KEY` with `MODEL_MODE=aiml`, or use `MODEL_MODE=dev` with AWS/GCP creds.
3. `pnpm agents` to connect the agents, then in a band.ai room add the agents + a human and post a marketing asset @mentioning the coordinator.

## License
MIT
