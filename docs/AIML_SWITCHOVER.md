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

## Use diverse, best-fit model families on AIML
Multi-model by design is the point of this review board and a judging criterion, and
AI/ML API is used to its fullest when each model-calling agent runs the model FAMILY
best at its specific job, drawn from across AIML's catalog (Claude, Gemini, GPT,
DeepSeek, Grok, Llama, Qwen, Mistral, ...), not just Claude and Gemini. Do NOT collapse
every agent onto one provider. The `aiml` column in `ROUTES` (`src/models/route.ts`)
spreads families by task fit:
- US reviewer (claim substantiation, careful reasoning): `openai/gpt-5-2`
- EU reviewer (strict rule-following): `google/gemini-2.5-pro`
- LATAM reviewer (localization, open model): `meta-llama/llama-3.1-8b-instruct`
- Brand reviewer (voice and tone nuance): `anthropic/claude-haiku-4.5`
- Remediation (copy rewrite): `deepseek/deepseek-chat`; image (Nano Banana): `google/gemini-2.5-flash-image`

Coordinator and Reconcile are orchestration/rule-based in this build and do not call a
model; their ROUTES entries are nominal. Choose the family best at each task (reasoning,
rule-following, multilingual, creative voice, code, ...), and verify each slug resolves
via `GET https://api.aimlapi.com/models` before the demo (AIML's exact slugs vary).

## Perception (the three-modalities path: text, image, audio)

The multimodal pre-pass (`src/perception/perceive.ts`) "sees" and "hears" each
visual/video material ONCE and turns it into TEXT artifacts (visual description,
on-screen text, detected claims, transcript) that cascade to every reviewer, so a
text-only region model (Llama) still benefits. Only this pre-pass sends image
content blocks; the reviewer roles above are unchanged. Two new perception roles,
both AIML-default and `MODEL_MODE`-aware (`src/models/route.ts`,
`describePerception()`):

- `perception-vision`: a vision-capable AIML chat model that reads the sampled
  keyframes (sent as OpenAI `image_url` parts). Default slug `openai/gpt-5-2`,
  overridable with `AIML_VISION_MODEL`. In `dev` mode it routes to Vertex
  `gemini-2.5-flash` (also vision-capable).
- `perception-stt`: a Whisper-class AIML transcription model on the OpenAI-
  compatible `/audio/transcriptions` endpoint. Default slug `#g1_whisper-large`,
  overridable with `AIML_STT_MODEL`. STT has no Bedrock equivalent, so even `dev`
  mode uses AIML when `AIML_API_KEY` is present.

Graceful degradation is mandatory and built in at every step: if `ffmpeg` is
absent the pass falls back to seeded `frames` / `imageUrl`; if no vision model is
reachable it skips vision; if no STT model is reachable it keeps the pasted
`transcript` (or none). A material therefore ALWAYS still reviews, even with no
AIML key and no ffmpeg, which is also how the deterministic demo (`pnpm local`)
runs. Override the slugs in `.env`:

```
AIML_VISION_MODEL=openai/gpt-5-2     # any vision-capable AIML chat slug
AIML_STT_MODEL=#g1_whisper-large     # any AIML Whisper-class transcription slug
```

Verify both resolve via `GET https://api.aimlapi.com/models` before the demo
(AIML's exact vision/STT slugs vary).
