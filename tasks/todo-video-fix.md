# Fix: video player + text-on-screen review

Branch: worktree-fix-video-player (off origin/main)

## Problem
- The `<video>` shows the browser broken-media icon; `GET /api/videos/:name` leaks a raw 500.
- The transcript panel shows a leaked technical string: "Could not read the stored video (500)".
- Text-on-screen videos (no voice) never get perception answers at upload time, so the panel stays empty.

## Decisions (confirmed with user)
- Text videos: ALWAYS synthesize plausible answers (no model call), deterministic from authored fields + frames.
- Player: graceful fallback + frames AND real playback (HTTP Range/streaming, hardened route).

## Tasks
- [x] Store: add `videoFile(name)` returning `{ path, size }` for streaming.
- [x] Backend: harden `GET /api/videos/:name` to never 500 (try/catch -> 404) and add HTTP Range/streaming.
- [x] Perception: new `synthesizeVideoPerception(material, frames)` (deterministic, never throws).
- [x] Wire synthesis into upload-time `transcribeVideoMaterial` (fills empty perception fields).
- [x] Frontend: `<video onError>` graceful fallback (frames/poster or clean card), not the broken icon.
- [x] Frontend: friendlier, non-technical transcribe error copy.
- [x] Tests: unit test for synthesis; typecheck; run vitest.

## Review
- Backend (`src/server/index.ts`, `src/store/store.ts`): `/api/videos/:name` now streams from disk
  with HTTP Range support and is wrapped so a missing/unreadable file is a clean 404, never a 500.
  Added `store.videoFile(name)` -> `{ path, size }` (total, never throws).
- Perception (`src/perception/synthesize.ts`, `transcribe.ts`): text-on-screen videos (no spoken
  transcript) now get a deterministic synthesized perception (transcript reading + on-screen text +
  visual description + claims) from the authored copy/claim + frames. Fills empty fields only, so a
  real STT transcript or prior perception is never overwritten. Per user decision: always synthesized
  (no model call) for the no-voice case.
- Frontend (`MaterialDetail.tsx`, `api.ts`): `<video onError>` falls back to a sampled frame (with a
  small "preview unavailable" caption) or a clean card instead of the browser broken-media icon; the
  transcribe error is now a friendly, non-technical message (no leaked HTTP status).

## Verification
- `npm run typecheck` (backend) clean; `tsc -b` (web) clean.
- `npx vitest run`: 50 files / 179 tests pass (updated 2 existing transcribe/upload tests to the new
  synthesized-perception contract; added `test/synthesize.test.ts`).
- Live server: missing video -> 404; full GET -> 200 + accept-ranges; Range -> 206 + content-range;
  past-EOF -> 416. No-audio upload -> persisted synthesized perception (transcript/on-screen
  text/visual description/claims/1 frame) and `transcribed: true`.
