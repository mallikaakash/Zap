# Cloud Run (`*.a.run.app`)

Managed HTTPS URL (no Caddy/sslip.io). Same app as the VM: `pnpm start` runs Next.js on `PORT` (8080) and the settlement worker.

## Deploy

### Automatic (recommended)

Every **push to `main`** runs [`.github/workflows/deploy-zap.yml`](../.github/workflows/deploy-zap.yml): build `Dockerfile`, push to Artifact Registry, deploy service **`zap`**. NEAR keys and `PUBLIC_URL` remain on the Cloud Run service (not in git).

### Manual (bootstrap / env changes)

```bash
bash scripts/gcp-cloudrun-deploy.sh   # copies .env from VM, full env refresh
```

## Notes

- **SQLite** (`DATABASE_URL=file:./.uc/live.db`): use `--min-instances 1` so one instance holds the DB; new revisions start a fresh DB unless you migrate to Postgres or copy `live.db` into the image (not recommended).
- **Secrets**: passed as Cloud Run env vars (prefer Secret Manager for production).
- **VM vs Run**: you can keep the VM for backup or retire it after Run is verified.

Verification (2026-11-13): deploy uses `gcloud run deploy --source .` like the existing `fence` service in project `project-bf77a013-c0b3-413c-a75`.
