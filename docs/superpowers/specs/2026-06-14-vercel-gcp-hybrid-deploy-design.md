# Hybrid deploy: Vercel SPA + GCP Cloud Run backend

## Goal

Run the dashboard on Vercel with Git auto-deploy on every push, and the backend
on Google Cloud Run (using GCP credits), keeping the live Band room alive. The
artifact viewer links agents paste must open the Vercel dashboard.

## Decisions (settled with the user)

- Vercel hosts the `web/` SPA; auto-deploy via Git integration (push to `main`
  deploys production).
- The backend runs on GCP Cloud Run, not Vercel functions and not Railway.
- The live Band room (persistent agent connections) stays running, on Cloud Run.
- State moves off local disk to GCP managed storage so redeploys do not lose it.

## Why Cloud Run, not Vercel functions

A Vercel serverless function is request-scoped and cannot hold the persistent
outbound connections band mode needs. Cloud Run is serverless (scale-to-zero,
managed, deploy a container) but, with `--min-instances=1` and CPU always
allocated, it keeps one instance warm running a long-lived process. So the
existing Hono backend deploys as-is, no rewrite into stateless handlers. This
satisfies "serverless" and "keep the live room" at once.

## Topology

```
Browser
  -> Vercel (web/ SPA: dashboard + /a/:id viewer, Git auto-deploy)
       static assets served by Vercel
       /api/*  --(vercel.json rewrite, server-side proxy, same-origin)-->
  -> Cloud Run (Hono backend: band-mode observer + REST + SSE)
       min-instances=1, max-instances=1, --no-cpu-throttling, --timeout=3600
       state:
         Cloud SQL (Postgres)  reviews, assets, rulebooks, precedents, artifacts
         GCS bucket            image + artifact bytes
       reaches band.ai with the agent credentials (persistent connection)
```

The DB stays private to Cloud Run (Unix-socket connector). Vercel never talks to
Cloud SQL directly; the SPA reaches data only through the Cloud Run API via the
`/api/*` proxy rewrite, which also avoids CORS (the browser sees one origin).

## Pieces of work

### 1. Storage seam (lands WITH the GcpStore, not before)

Extract a `StoreApi` interface covering the current `Store` surface
(`saveReview/listReviews/getReview`, `appendPrecedent/listPrecedents`,
`listAssets/saveAsset`, `getRulebookOverride/saveRulebookOverride`,
`hostImage/readImage`, `saveArtifact/getArtifact`). The existing file-backed
`Store` implements it; a new `GcpStore` implements it against Postgres + GCS. The
server picks the implementation from an env flag (`STORAGE=gcp|file`, default
`file`).

Important constraint: the current `Store` is synchronous (node:fs), but a
Postgres/GCS store is inherently asynchronous. A faithful `StoreApi` must
therefore be async (methods return Promises), which ripples through every call
site, including `makeOnEvent`'s `hostImage` call and the agents' injected
`hostImage`/`publishArtifact` capabilities. Because that conversion is only
meaningful once there is a real async implementation to validate against, the
seam + async conversion land together with the `GcpStore` in phase 2, not as a
blind sync interface beforehand. Until then the file `Store` stays synchronous
and the suite is untouched.

### 2. GcpStore implementation (needs provisioning to test)

- Postgres via `pg`. One table per collection, or a generic `kv(collection,
  id, doc jsonb)` table keyed by `(collection, id)` for reviews/assets/
  rulebooks/precedents/artifacts. JSONB keeps it close to the current JSON
  shapes, minimal schema churn. Connect over the Cloud SQL Unix socket
  (`host=/cloudsql/PROJECT:REGION:INSTANCE`).
- Blob bytes via `@google-cloud/storage` using Application Default Credentials
  (the Cloud Run service account; no key files). `hostImage` writes the decoded
  bytes to the bucket and returns a URL; `readImage` is no longer needed if we
  serve bytes straight from GCS. For the hackathon, a public bucket is the
  fastest path; switch to V4 signed URLs if artifacts must stay private.
- `hostImage` currently returns `/api/images/:name` (served by the backend).
  With GCS we return the object URL (public) or a signed URL instead, so the
  backend stops proxying image bytes. Artifact `src` for images then points at
  GCS, which the Vercel SPA can load directly.

### 3. Dockerfile for Cloud Run (no cloud access needed)

Container runs the existing server. The project resolves asset paths via
`new URL('../../assets/', import.meta.url)`, so we keep the source layout and run
with `tsx` rather than compiling to `dist/` (a `tsc` build would relocate files
and break those relative URLs). Node 22, pnpm, `CMD` runs
`tsx src/server/index.ts`, listening on `process.env.PORT` (Cloud Run injects it,
default 8080), binding `0.0.0.0` (the node-server adapter default). A
`.dockerignore` keeps `node_modules`, `web/`, `data/`, and `.git` out of the
build context.

### 4. vercel.json + Root Directory (no cloud access needed)

`vercel.json` at repo root, with the API proxy rule BEFORE the SPA fallback
(rewrites are ordered; a catch-all to index.html would otherwise swallow
`/api`):

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://CLOUD_RUN_URL/api/:path*" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

`CLOUD_RUN_URL` is filled once the service exists. In the Vercel project, set
Root Directory to `web` so only the SPA builds and Vite is auto-detected. (If the
SPA build needs the repo-root lockfile, enable "Include source files outside the
Root Directory".)

### 5. Public base URL for pasted links

`PUBLIC_BASE_URL` (already read by the server, Vercel-aware) is set on Cloud Run
to the Vercel production URL, so `publishArtifact` mints links like
`https://<vercel-app>/a/:id` that open the dashboard. The SPA then fetches
`/api/artifacts/:id`, proxied to Cloud Run.

### 6. Reconnect on boot

Cloud Run can recycle the instance (deploys, maintenance). The band transport
must reconnect to the room on startup so a restart self-heals. Verify the
current `RealBandTransport`/`BandBoard.start()` re-establishes agent connections
on process start (it runs at boot today), and that a dropped connection is
re-established or the instance restarts. This is the one reliability item to
confirm before relying on Cloud Run for the live room; a GCE VM is the fallback
if Cloud Run recycling proves disruptive.

## Provisioning (needs the user's GCP + Vercel auth)

GCP:
1. Create a Cloud SQL Postgres instance; note `PROJECT:REGION:INSTANCE`.
2. Create a GCS bucket for artifacts/images.
3. Grant the Cloud Run service account `Cloud SQL Client` and
   `Storage Object Admin` (or narrower) on the bucket.
4. Deploy:
   ```sh
   gcloud run deploy band-backend --source . \
     --region=us-central1 --allow-unauthenticated \
     --min-instances=1 --max-instances=1 --no-cpu-throttling --timeout=3600 \
     --add-cloudsql-instances=PROJECT:REGION:INSTANCE \
     --set-env-vars=STORAGE=gcp,PUBLIC_BASE_URL=https://<vercel-app>,GCS_BUCKET=<bucket>,DB_SOCKET=/cloudsql/PROJECT:REGION:INSTANCE,BOARD_MODE=band,<band agent ids/keys>
   ```

Vercel:
1. Import the GitHub repo as a project (this enables Git auto-deploy by default).
2. Set Root Directory to `web`.
3. Put the Cloud Run URL into `vercel.json`'s `/api` rewrite and push.

## Testing

- Storage seam: the existing suite stays green with the file `Store` (no test
  changes). Add a small contract test that runs the same round-trip assertions
  against any `StoreApi` so `GcpStore` can be checked once a test database is
  available (or against a local Postgres in CI).
- Dockerfile: `docker build` succeeds and the container serves `/api/reviews`
  locally (BOARD_MODE=local) on `$PORT`.
- vercel.json: client deep-links (`/a/:id`, `/reviews/:id`) resolve on hard
  refresh in a Vercel preview; `/api/*` reaches the backend.
- End to end: an agent-pasted `https://<vercel-app>/a/:id` opens the viewer and
  renders the artifact whose bytes live in GCS.

## Out of scope

- Vercel-to-Cloud-SQL direct access (dynamic Vercel egress IPs make it
  impractical; the DB stays private to Cloud Run).
- Compiling the backend to `dist/` (kept on `tsx` to preserve asset path
  resolution).
- Multi-instance scaling (pinned to one instance to keep in-memory review/SSE
  state and a single Band connection coherent).

## Phasing

1. Deploy artifacts that need no cloud access: Dockerfile, .dockerignore,
   vercel.json (Cloud Run URL filled later), and this spec. Mergeable now. Lets
   the file-store backend deploy to Cloud Run immediately for a demo, with state
   ephemeral (lost on instance recycle/redeploy) until phase 2.
2. Storage seam (async `StoreApi`) + `GcpStore` (Postgres + GCS), after Cloud SQL
   and a GCS bucket exist. This is where state becomes durable. Includes the
   async conversion of `hostImage`/`publishArtifact` call sites.
3. Deploy: Cloud Run + Vercel import, wire URLs/env, verify end to end.
