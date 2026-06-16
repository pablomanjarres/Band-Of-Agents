# Running the live Band.ai review

The web app reviews campaigns in two ways:

- **Local mode** (the default, what the hosted app runs): `BOARD_MODE` unset / `local`. The review runs in-process. This is deterministic and always produces per-region verdicts, so it is the safe demo path.
- **Band mode**: `BOARD_MODE=band`. The review runs through real Band.ai agents in one room per material. This is the cross-framework coordination showcase.

## The cast matters

Band mode (and `CampaignBandSession`) drives the **classic** cast:

> Coordinator to US / EU / LATAM / Brand reviewers to **Reconcile**

Only Reconcile emits the **per-region verdicts** the dashboard renders. The pods cast in `src/run/agents.ts` (`pnpm agents`, Conductor to pod leads to Mediator to Adjudicator) is a different topology: it files pod findings and one terminal decision, not per-region verdicts. If you connect the pods cast and run a campaign review from the web, every region stays on "reviewing" because no per-region verdict event is ever emitted. Use the classic cast.

## Models: run everything on Vertex

In `MODEL_MODE=dev`, US / Brand / Remediation route to Bedrock (needs AWS credentials). If you only have a GCP credential, use **`MODEL_MODE=vertex`**: every agent runs on Gemini via Vertex, so the whole flow works on one credential, no AIML key and no AWS. (Perception, vision + STT, already falls back to Vertex when no AIML key is set.)

## Two ways to run it

Both need the classic agents' credentials in `.env`: `COORDINATOR`, `US`, `EU`, `LATAM`, `BRAND`, `RECONCILE`, `REMEDIATION`, `INTAKE` (each `_AGENT_ID` and `_API_KEY`), plus `GOOGLE_GENAI_USE_VERTEXAI=true` and `GOOGLE_CLOUD_PROJECT`.

### Web-driven (recommended)

```
MODEL_MODE=vertex pnpm serve:band
```

The server connects the classic cast AND serves the portal. Open a campaign, click **Run review**, and the per-material verdicts stream back to the page as the agents reconcile in their Band.ai rooms.

### Manual (in app.band.ai)

```
MODEL_MODE=vertex pnpm agents:classic
```

Then in app.band.ai: create a room, add the connected agents + the human reviewer, and post `Coordinator, review campaign <name>`. Reconcile posts the verdicts back into the room. (This mirrors `pnpm agents` for pods, but with the classic cast that produces per-region verdicts.)
