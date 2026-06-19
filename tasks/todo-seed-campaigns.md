# Seed new campaigns with real Vertex media

Goal: add 3 new fictional marketing campaigns to the local board store, each with
generated images (Vertex Nano Banana, the platform's existing image path) and one
short hero video (Vertex Veo, new). Land in band-review-board/data via the Store.

Decisions (confirmed with user):
- Video: add Veo, one short hero clip per campaign.
- Breadth: 2-3 campaigns across regulated categories (built-in reviewer conflict).
- Target: local band-review-board store (data/campaigns.json + data/images + data/videos).
- Use the Vertex path directly (not AIML), even though AIML_API_KEY is set.

## Plan

- [x] 1. Add a Veo video-gen seam to the platform (minimal, additive)
  - [x] client.ts: add `VideoRequest` / `VideoResult` types + optional `generateVideo?` on ModelClient
  - [x] gemini.ts: add `GeminiModelClient.generateVideo()` (generateVideos -> poll -> bytes)
- [x] 2. Veo smoke test PASSED on project=noelle-agents, veo-3.0-fast-generate-001.
  - Returns inline videoBytes (~1.2MB mp4), ~130s/clip. No GCS bucket needed.
  - Gotcha: do NOT pass durationSeconds/generateAudio to veo-3-fast (empty output). Default config only.
- [x] 3. Authored 3 campaigns with dossiers + ads + materials + image/video prompts:
  - NovaPay 0% intro APR card (pricing / negative-option / APR disclosure)
  - Lumora retinol serum "clinically proven" (cosmetic vs drug claims / substantiation)
  - VoltLeaf plant energy drink "boosts focus" (health-claim substantiation / EFSA)
- [x] 4. Seed script src/run/seed-campaigns.ts: per material generate image (Vertex), per hero generate video (Veo), host bytes via Store, saveCampaign.
- [x] 5. Ran seed; verified data/campaigns.json + 6 data/images/*.png + 3 data/videos/*.mp4.
- [x] 6. typecheck clean; confirmed all 3 campaigns + media served (GET /api/campaigns, image 200, video 206).

## Review
Done. Added a minimal additive Veo seam (client.ts VideoRequest/VideoResult +
generateVideo?, gemini.ts GeminiModelClient.generateVideo) and a self-contained
seeder (src/run/seed-campaigns.ts) that uses the Vertex path directly (forced, not
AIML) for both images (gemini-2.5-flash-image) and video (veo-3.0-fast).

Generated (all real, Vertex/GCP project noelle-agents):
- 3 campaigns persisted to data/campaigns.json
- 6 images (1024x1024 PNG) in data/images
- 3 hero videos (mp4, 55-68s gen each) in data/videos

Verified via a fresh `PORT=8899 BOARD_MODE=local serve`: GET /api/campaigns lists
all 3; /api/images/<id>.png -> 200; /api/videos/<id>.mp4 -> 206 (range/streaming ok).

Scripts added: `pnpm seed:campaigns`, `pnpm veo:smoke`.

Gotcha captured: veo-3-fast must use default config (no durationSeconds /
generateAudio override) or it returns an empty result. generateVideo only forwards
those when explicitly set, so the default path is safe.

Not done (out of scope / would need a call): perception artifacts are left unset so
the reviewers perceive at review time; nothing pushed to the hosted Cloud Run
backend (user chose local); no git commit (waiting on user).
