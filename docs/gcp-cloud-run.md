# Cloud Run (`*.a.run.app`)

Managed HTTPS URL (no Caddy/sslip.io). Same app as the VM: `pnpm start` runs Next.js on `PORT` (8080) and the settlement worker. The container starts through [`scripts/cloudrun-entrypoint.sh`](../scripts/cloudrun-entrypoint.sh).

## Deploy

### Automatic (recommended)

Every **push to `main`** runs [`.github/workflows/deploy-zap.yml`](../.github/workflows/deploy-zap.yml): build `Dockerfile`, push to Artifact Registry, deploy service **`zap`**. NEAR keys and `PUBLIC_URL` remain on the Cloud Run service (not in git).

### Manual (bootstrap / env changes)

```bash
bash scripts/gcp-cloudrun-deploy.sh   # copies .env from VM, full env refresh
```

## Keep the database across deploys (do this once)

The app stores the off-chain half of every order in SQLite (`.uc/live.db`): seller sign-ups and dashboard links, products, refund chats, emails, webhook logs. Inside a container that file is lost on every new revision. [Litestream](https://litestream.io) fixes this: on start it restores the database from a Cloud Storage bucket, and while running it streams every change back. It is switched on by one env var; without it the app runs as before.

**Quick path (recommended):**

```bash
bash scripts/litestream-bootstrap.sh
```

Override `GCP_PROJECT`, `GCP_REGION`, `RUN_SERVICE`, or `LITESTREAM_BUCKET` if needed. The script creates the bucket (default `zap-db-$PROJECT`), grants the Cloud Run runtime service account **object admin**, and sets `LITESTREAM_REPLICA_URL` on the service.

**Manual equivalent:**

```bash
PROJECT=project-bf77a013-c0b3-413c-a75
REGION=us-central1
BUCKET=zap-db-$PROJECT            # any globally unique name

gcloud storage buckets create gs://$BUCKET --project=$PROJECT --location=$REGION --uniform-bucket-level-access

SA=$(gcloud run services describe zap --project=$PROJECT --region=$REGION --format='value(spec.template.spec.serviceAccountName)')
SA=${SA:-$(gcloud projects describe $PROJECT --format='value(projectNumber)')-compute@developer.gserviceaccount.com}
gcloud storage buckets add-iam-policy-binding gs://$BUCKET --member=serviceAccount:$SA --role=roles/storage.objectAdmin

gcloud run services update zap --project=$PROJECT --region=$REGION \
  --update-env-vars=LITESTREAM_REPLICA_URL=gcs://$BUCKET/zap/live.db \
  --max-instances=1 --no-cpu-throttling
```

Check: `curl -s https://<service>/api/health` returns `"database":"ok"`, and after the next deploy your sellers and products are still there.

If you refresh env from a `.env` file via `scripts/gcp-cloudrun-deploy.sh`, include `LITESTREAM_REPLICA_URL=gcs://…` in that file so a full env sync does not drop persistence.

**Why one instance, CPU always on:** SQLite has a single writer and Litestream a single replicator, so more than one instance would mean several separate databases. Cloud Run otherwise pauses the CPU between requests, which would stall both the settlement worker (minting receipts, running refunds) and replication. The workflow and `gcp-cloudrun-deploy.sh` set `--max-instances=1 --no-cpu-throttling`. The cost is one always-on small instance.

**A database you already have** (for example the VM's `.uc/live.db`) can seed the bucket: `litestream replicate .uc/live.db gcs://$BUCKET/zap/live.db` on that machine for a minute, then deploy.

## Optional features (env vars on the service)

Both are optional; without them the app still works.

| Feature | Env vars | Without it |
|---|---|---|
| Emails to anyone (dashboard link, payment/refund notices) | `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` (Gmail app password is typical) | Prefer SMTP on Cloud Run; see `.env.smtp.example` and `pnpm smtp:cloudrun`. |
| Emails via Resend (fallback if SMTP unset) | `RESEND_API_KEY` (or `RESEND`), `EMAIL_FROM` | Without a verified domain, Resend only delivers to the Resend account owner's address. |
| Refund assistant on NEAR AI Cloud | `NEARAI_API_KEY`, optional `NEARAI_BASE_URL`, `NEARAI_MODEL` | A deterministic rule engine with the same output shape answers instead. |

Set them with `gcloud run services update zap --update-env-vars=KEY=value` (or Secret Manager for keys). See `.env.example` for details.

## Health

`GET /api/health` → `{ ok, mode, networkId, database, ms, time }`, 200 when the database answers, 503 otherwise. It does not call the chain, so it is cheap enough for uptime checks.

## Notes

- **A fresh deploy without Litestream** has no sellers: `/shop` says so and links to the dashboard, and the landing page hides "Try the demo shop". Sign up again in `/dashboard` (docs/GO-LIVE.md §6).
- **Secrets**: passed as Cloud Run env vars (prefer Secret Manager for production).
- **VM vs Run**: you can keep the VM for backup or retire it after Run is verified.

Verification (2026-11-13): deploy uses `gcloud run deploy --source .` like the existing `fence` service in project `project-bf77a013-c0b3-413c-a75`.
