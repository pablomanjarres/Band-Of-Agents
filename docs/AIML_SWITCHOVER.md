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
AIML slug; in `dev` mode each maps to the equivalent Bedrock/Vertex model id.
Image generation (remediation) is AIML-only and has no dev equivalent.
