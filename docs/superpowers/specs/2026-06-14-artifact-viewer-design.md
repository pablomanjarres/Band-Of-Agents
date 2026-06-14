# Artifact viewer: agents paste dashboard links

## Problem

Band only lets agents post plain-English text. It has no way to attach or
display a file or an image. So when a reviewer agent produces an artifact (a
Nano Banana regenerated visual, the asset under review, a rulebook, a findings
report), there is nowhere in the Band room to show it. Today the only artifact
that surfaces is a single revised image rendered inline by `RemediationPanel`.

## Goal

Give agents a way to drop a link into the Band room that opens a viewer page in
our own dashboard, and that page renders the real artifact (image or structured
document). The agent pastes a normal URL into its normal Band message; a human
clicks it and sees the artifact.

## Decisions (settled during brainstorming)

- Build off `main` (the canonical, merged code lives on `origin/main`).
- The viewer renders images plus structured docs (markdown / JSON / text), not
  arbitrary file downloads and not an upload UI.
- Agents auto-post dashboard deep-links into Band as part of the review flow.
  No per-review gallery tab.

## Non-goals (YAGNI)

- No file uploads from the dashboard.
- No arbitrary binary file download path.
- No per-review artifact gallery page. (Artifacts carry an optional `reviewId`
  for context only.)
- No auth on the viewer. This is a hackathon demo; links are unguessable UUIDs.

## Architecture

A new lightweight artifact registry on the existing file-backed `Store`, two
new HTTP endpoints, a standalone viewer route in the React app, and a
`publishArtifact` capability threaded into agents the same way `hostImage`
already is.

### 1. Artifact model: `src/domain/artifact.ts` (new)

```ts
export const ArtifactKind = z.enum(['image', 'markdown', 'json', 'text']);

export const Artifact = z.object({
  id: z.string(),
  kind: ArtifactKind,
  title: z.string(),
  createdAt: z.number(),
  createdBy: z.string().optional(),   // agent name
  reviewId: z.string().optional(),    // context only, not a gallery
  src: z.string().optional(),         // image: hosted path (/api/images/x.png) or external url
  content: z.string().optional(),     // markdown/json/text: inline string
});
```

Invariant: an `image` artifact has `src`; a `markdown`/`json`/`text` artifact
has `content`. A small `NewArtifact` input type (everything except `id` and
`createdAt`) is what callers pass to publish.

Mapping to what agents actually produce:
- generated/campaign visuals -> `image` (src is the hosted `/api/images/...`)
- the asset under review, a rulebook, brand DNA -> `json`
- a findings / verdict report -> `markdown`

### 2. Store: `src/store/store.ts` (additive)

- `data/artifacts.json` backing file (same readJson/writeJson pattern as
  reviews/assets).
- `saveArtifact(a: Artifact): void` (replace-by-id then append, like
  `saveReview`).
- `getArtifact(id: string): Artifact | undefined`.
- Binary images keep flowing through the existing `hostImage()` ->
  `data/images/` path. Artifacts only ever store the resulting `/api/images/...`
  string in `src`, never base64.

### 3. publish helper: `src/store/artifacts.ts` (new, pure-ish)

```ts
export function buildArtifactUrl(baseUrl: string, id: string): string;
// -> `${baseUrl}/a/${id}`  (baseUrl has no trailing slash)

export function makePublishArtifact(store, baseUrl, now: () => number):
  (input: NewArtifact) => { id: string; url: string };
```

`makePublishArtifact` mints a UUID, stamps `createdAt`, calls
`store.saveArtifact`, and returns `{ id, url }`. The URL builder is split out so
it is testable without a store. `now` is injected so tests are deterministic.

### 4. Backend endpoints: `src/server/index.ts`

- `POST /api/artifacts`: body is a `NewArtifact`; returns `{ id, url }`.
  Used by any in-process caller; also usable directly for manual testing.
- `GET /api/artifacts/:id`: returns the `Artifact` JSON, or 404
  `{ error: 'not found' }`.
- The server constructs `publishArtifact` from the store and `PUBLIC_BASE_URL`
  and passes it into the board session opts (next section).

New env: `PUBLIC_BASE_URL`, default `http://localhost:${PORT}` (the port the
server already reads). This is the origin baked into pasted links so they
resolve when a human clicks them from the Band UI.

### 5. Agent integration: `publishArtifact` capability

Thread `publishArtifact` into agent opts exactly like the existing `hostImage`
injection (`hostImage: (u) => store.hostImage(u) ?? u` is wired in both the
`/api/reviews` handler and the band-session path). Two integration points prove
both media types end to end:

- **Remediation agent** (`src/agents/remediation.ts`): after regenerating the
  visual and hosting it, publish an `image` artifact (`src` = the hosted url,
  `title` = e.g. `"US visual (revised)"`, `reviewId`, `createdBy`) and include
  the returned `url` in the `sendMessage` it already posts to the coordinator:
  "...regenerated the {region} visual, view it here: {url}".

- **Reconcile agent** (`src/agents/reconcile.ts`): when it issues the verdict,
  publish a `markdown` report (findings grouped by region + the verdicts) and
  post a short Band message with the link.

Both capabilities are optional in the agent opts (`publishArtifact?`), so the
fake/in-process and test paths that do not provide it still work unchanged.

### 6. Viewer page: `web/src/pages/ArtifactViewerPage.tsx`, route `/a/:id`

- Registered in `web/src/App.tsx` as `<Route path="/a/:id" .../>`.
- Fetches `/api/artifacts/:id` via a new `api.ts` function `getArtifact(id)`.
- Renders by kind:
  - `image` -> `<img src={src}>` on a neutral backdrop.
  - `markdown` -> rendered markdown.
  - `json` -> pretty-printed, syntax-friendly `<pre>` (parse, re-stringify with
    indentation; fall back to raw on parse failure).
  - `text` / unknown kind -> preformatted text.
- Header: title, `createdBy`, and a back-link to the review
  (`/reviews/:reviewId` if present, else the dashboard home).
- States: loading, not-found (clean message), error.
- Standalone and minimal so the pasted link opens straight to the artifact.

Markdown rendering: check whether a markdown renderer is already a dependency in
`web/package.json`. If yes, use it. If not, a minimal renderer (headings, bold,
lists, code, links) is enough for the report; do not add a heavy dependency for
this. Decide during planning based on what is already there.

## Data flow

1. An agent produces an artifact.
2. `publishArtifact(input)` writes it to the Store and returns
   `${PUBLIC_BASE_URL}/a/:id`.
3. The agent pastes that URL into its normal Band `sendMessage` (real link,
   plain text).
4. A human reads the Band room, clicks the link.
5. `/a/:id` loads, fetches `/api/artifacts/:id`, renders the artifact by kind.

## Error handling

- `GET /api/artifacts/:id` on an unknown id -> 404 `{ error: 'not found' }`;
  the viewer shows a clean "artifact not found" state.
- Image `src` that points at `/api/images/:name` is already filename-sanitized
  by `Store.readImage`; the artifact layer adds no new file reads.
- Unknown `kind` in a stored artifact -> viewer falls back to text rendering.
- `POST /api/artifacts` with a body that fails `NewArtifact` validation -> 400.

## Testing

`test/artifacts.test.ts` (Vitest, matching the existing `test/` style):
- Store `saveArtifact` then `getArtifact` round-trips an artifact of each kind.
- `getArtifact` on a missing id returns `undefined`.
- `buildArtifactUrl` joins base + id with exactly one slash and no trailing
  slash duplication.
- `makePublishArtifact` mints an id, stamps `createdAt` from the injected clock,
  persists via the store, and returns the matching `{ id, url }`.
- Kind fallback: an artifact with an unexpected kind value still round-trips
  through the store (the viewer fallback is a UI concern, asserted minimally if
  a component test harness exists; otherwise covered by the store round-trip).

Manual verification (walking skeleton, proves end to end):
- Start the server, `POST /api/artifacts` a `markdown` artifact, open the
  returned URL in the browser, confirm it renders.
- Run a review through to a remediation/verdict and confirm the agent's Band
  message contains a `/a/:id` link that opens the regenerated image and the
  report.

## Files touched

New:
- `src/domain/artifact.ts`
- `src/store/artifacts.ts`
- `web/src/pages/ArtifactViewerPage.tsx`
- `test/artifacts.test.ts`

Changed:
- `src/store/store.ts` (saveArtifact/getArtifact + artifacts.json)
- `src/server/index.ts` (two endpoints, PUBLIC_BASE_URL, wire publishArtifact)
- `src/agents/remediation.ts` (publish image artifact, link in message)
- `src/agents/reconcile.ts` (publish report artifact, link in message)
- `src/board/*` session opts + types to thread `publishArtifact` (mirror
  `hostImage`)
- `web/src/App.tsx` (route)
- `web/src/api.ts` (getArtifact)
