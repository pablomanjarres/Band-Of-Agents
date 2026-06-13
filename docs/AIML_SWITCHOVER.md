# AIML switchover (the main model path)

AI/ML API is the architectural main path for this project. Every chat agent can
run on AIML's OpenAI-compatible gateway, and Nano Banana image generation is
AIML-only. AWS Bedrock and GCP Vertex are dev-time cost-savers, selected by one
switch, so we can test without burning AIML credit.

## The switch
`MODEL_MODE` (env var, read in `src/models/route.ts`):
- `aiml` (the default when unset): every agent routes through AIML
  (`https://api.aimlapi.com/v1`) via the official `openai` SDK. Requires `AIML_API_KEY`.
- `dev`: cost-saver. Claude agents use AWS Bedrock (`~/.aws` creds, `AWS_REGION`);
  Gemini agents use GCP Vertex (`GOOGLE_GENAI_USE_VERTEXAI=true`, ADC). Mirrors the
  models the sibling `noelle` project uses.

## Run 100% on AIML (remove every non-AIML path)
1. Set `MODEL_MODE=aiml` and `AIML_API_KEY=...` in `.env`. That is all that is
   required functionally: every agent now calls AIML.
2. To physically remove the cost-savers, delete the `dev` branch in
   `src/models/route.ts` and the files `src/models/bedrock.ts` and
   `src/models/gemini.ts` (and their deps). Only `src/models/aiml.ts` and the
   `aiml` branch remain.
3. Smoke-test before relying on it: one chat completion and one Nano Banana image
   via AIML, to confirm the model slugs resolve and the key has image-endpoint
   access (AIML's published Claude/Gemini slugs vary; verify with
   `GET https://api.aimlapi.com/models`).

## Per-agent routing
See `describeRoutes()` in `src/models/route.ts`. In `aiml` mode each role uses an
AIML slug; in `dev` mode each maps to the equivalent Bedrock/Vertex/Featherless model id.
Image generation (remediation) is AIML-only and has no dev equivalent.

## Keep the models different after the switch
Multi-model by design is the point of this review board (and a judging criterion):
even on full AIML, each agent should run a DIFFERENT model, not one shared model.
AIML's single gateway hosts Claude, Gemini, GPT, and open-source models, so preserve
the variety through it. The `aiml` column in `ROUTES` (`src/models/route.ts`) already
assigns a distinct slug per role, for example:
- Coordinator: `google/gemini-2.5-flash`
- US reviewer: `anthropic/claude-sonnet-4.5`
- EU reviewer: `google/gemini-2.5-pro`
- LATAM reviewer: an open model (e.g. `meta-llama/llama-3.1-8b-instruct`, or a Qwen/Mistral slug)
- Brand reviewer: `anthropic/claude-haiku-4.5`
- Reconcile: a strong model (e.g. `anthropic/claude-opus-4-5`)
- Remediation: `anthropic/claude-sonnet-4.5` for copy, `google/gemini-2.5-flash-image` for the image

Do NOT collapse every agent onto one model. Verify each slug resolves via
`GET https://api.aimlapi.com/models` before the demo (AIML's exact Claude 4.6 and
open-model slugs vary).
