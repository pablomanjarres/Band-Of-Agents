# Cloud Run image for the Hono backend (band-mode observer + REST + SSE).
# We run the TypeScript sources with tsx rather than compiling to dist/: the
# server resolves assets via new URL('../../assets/', import.meta.url), and a
# tsc build would relocate files and break those relative paths. Cloud Run
# injects PORT (default 8080); the node-server adapter binds 0.0.0.0.
#
# Deploy (see docs/superpowers/specs/2026-06-14-vercel-gcp-hybrid-deploy-design.md):
#   gcloud run deploy band-backend --source . --region=us-central1 \
#     --min-instances=1 --max-instances=1 --no-cpu-throttling --timeout=3600 \
#     --add-cloudsql-instances=PROJECT:REGION:INSTANCE --allow-unauthenticated

FROM node:22-slim

WORKDIR /app
# ffmpeg powers the perception pre-pass (audio extraction for STT, keyframe
# extraction for vision). node:22-slim does not ship it, so a hosted video upload
# would silently produce an empty transcript without this install.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
# Install pnpm directly (avoids corepack's interactive download prompt in CI).
RUN npm install -g pnpm@10.30.3

# Install deps first for layer caching. tsx is a devDependency, so install the
# full set (the runtime entrypoint is tsx).
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# App sources and the runtime assets the server reads.
COPY tsconfig.json ./
COPY src ./src
COPY assets ./assets

ENV NODE_ENV=production
# Cloud Run sets PORT; EXPOSE is documentation only.
EXPOSE 8080
CMD ["pnpm", "exec", "tsx", "src/server/index.ts"]
# (pnpm install above includes devDependencies, so tsx is on PATH at runtime.)
