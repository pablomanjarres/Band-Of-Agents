# Setting the AIML API key (privately)

The reviewer agents and perception run on the **Cloud Run `band-backend` service**, not
on Vercel. The SPA on Vercel never calls a model directly, so the `AIML_API_KEY` must
live on `band-backend`. A key set in Vercel env does nothing.

## How the routing behaves

`band-backend` runs with `MODEL_MODE=aiml`, so AIML is the wired/preferred provider:

- **No `AIML_API_KEY` (today):** every agent gracefully falls back to the current dev
  models (Vertex / Bedrock / Featherless). Nothing breaks. Note Bedrock-routed agents
  (US, Brand) need AWS creds, so without AIML they may not all conclude.
- **`AIML_API_KEY` set:** every agent + image gen + perception routes through AIML
  automatically (one provider, no AWS dependency) — all four regions should conclude.

No code change or redeploy of your own is needed when you add the key; the next request
picks it up (Cloud Run rolls a new revision on the env/secret update).

## Recommended: keep the key private via Secret Manager

This keeps the key out of `gcloud run services describe` output, logs, and the revision
config (a plain `--update-env-vars` value is visible to anyone with project access).

```bash
PROJECT=noelle-agents
REGION=us-east1
PY=/opt/homebrew/opt/python@3.12/bin/python3.12   # gcloud needs python 3.12

# 1) Create the secret and add your key as a version. Paste the key at the prompt
#    (printf avoids it landing in your shell history; do NOT echo it).
CLOUDSDK_PYTHON=$PY gcloud secrets create AIML_API_KEY --project "$PROJECT" --replication-policy=automatic 2>/dev/null || true
printf '%s' 'PASTE_YOUR_AIML_KEY_HERE' | CLOUDSDK_PYTHON=$PY gcloud secrets versions add AIML_API_KEY --project "$PROJECT" --data-file=-

# 2) Grant the Cloud Run runtime service account read access to the secret.
SA=1068570846548-compute@developer.gserviceaccount.com
CLOUDSDK_PYTHON=$PY gcloud secrets add-iam-policy-binding AIML_API_KEY \
  --project "$PROJECT" --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor

# 3) Point band-backend's AIML_API_KEY env at the secret (replaces any plain value).
CLOUDSDK_PYTHON=$PY gcloud run services update band-backend \
  --project "$PROJECT" --region "$REGION" \
  --update-secrets AIML_API_KEY=AIML_API_KEY:latest
```

To rotate the key later, add a new secret version (step 1's second command); the
service reads `:latest` on its next revision (re-run step 3 to roll one immediately).

## Quick path (less private)

If you don't mind the value being visible in the revision config, skip Secret Manager:

```bash
CLOUDSDK_PYTHON=/opt/homebrew/opt/python@3.12/bin/python3.12 \
gcloud run services update band-backend --region us-east1 --project noelle-agents \
  --update-env-vars AIML_API_KEY=YOUR_AIML_KEY
```

## Verify it took effect

```bash
# The service should report mode=band; a review should now conclude across all regions.
curl -s https://band-backend-1068570846548.us-east1.run.app/api/reviews \
  | python3 -c "import sys,json;print('mode=',json.load(sys.stdin).get('mode'))"
```

Then open the dashboard, click **"Open review chat"** on an advertisement, and watch the
agents — with AIML live, US/EU/LATAM/Brand should all report and reconcile to verdicts.

## Revert to the dev models

Remove the key (the graceful fallback takes over again):

```bash
CLOUDSDK_PYTHON=/opt/homebrew/opt/python@3.12/bin/python3.12 \
gcloud run services update band-backend --region us-east1 --project noelle-agents \
  --remove-secrets AIML_API_KEY   # or --remove-env-vars AIML_API_KEY for the quick path
```

## Spend note

With the key set, every agent call, image generation, and perception pass goes through
AIML and accrues against that credit (the in-app spend tracker shows the running total).
To save credit during heavy testing, set `MODEL_MODE=dev` on `band-backend` to route
volume back to Vertex/Bedrock/Featherless while keeping AIML available.
