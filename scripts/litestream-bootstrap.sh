#!/usr/bin/env bash
# One-time: GCS bucket + IAM + LITESTREAM_REPLICA_URL on Cloud Run for SQLite persistence.
# Idempotent — safe to re-run. See docs/gcp-cloud-run.md.
set -euo pipefail

PROJECT="${GCP_PROJECT:-project-bf77a013-c0b3-413c-a75}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${RUN_SERVICE:-zap}"
BUCKET="${LITESTREAM_BUCKET:-zap-db-${PROJECT}}"
REPLICA_PATH="${LITESTREAM_REPLICA_PATH:-zap/live.db}"
REPLICA_URL="gcs://${BUCKET}/${REPLICA_PATH}"

echo "==> Litestream bootstrap (project=$PROJECT region=$REGION service=$SERVICE)"
echo "    replica: $REPLICA_URL"

if ! gcloud storage buckets describe "gs://${BUCKET}" --project="$PROJECT" &>/dev/null; then
  echo "==> Creating bucket gs://${BUCKET}"
  gcloud storage buckets create "gs://${BUCKET}" \
    --project="$PROJECT" \
    --location="$REGION" \
    --uniform-bucket-level-access
else
  echo "==> Bucket gs://${BUCKET} already exists"
fi

SA="$(gcloud run services describe "$SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --format='value(spec.template.spec.serviceAccountName)' 2>/dev/null || true)"
if [[ -z "$SA" ]]; then
  NUM="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
  SA="${NUM}-compute@developer.gserviceaccount.com"
fi
echo "==> Granting objectAdmin on gs://${BUCKET} to $SA"
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${SA}" \
  --role="roles/storage.objectAdmin" \
  --quiet >/dev/null

echo "==> Updating Cloud Run service (LITESTREAM_REPLICA_URL, single instance, CPU always on)"
gcloud run services update "$SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --update-env-vars="LITESTREAM_REPLICA_URL=${REPLICA_URL}" \
  --max-instances=1 \
  --min-instances=1 \
  --no-cpu-throttling \
  --quiet

URL="$(gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format='value(status.url)')"
echo "==> Done. New revision will restore/replicate .uc/live.db from $REPLICA_URL"
echo "    Health: curl -sS '${URL}/api/health'"
echo ""
echo "Optional — copy an existing database into the bucket before the first write:"
echo "  litestream replicate /path/to/.uc/live.db ${REPLICA_URL}"
echo "  (e.g. from VM: gcloud compute scp uc-checkout:/opt/zap/.uc/live.db ./live.db ...)"
echo ""
echo "If you later run scripts/gcp-cloudrun-deploy.sh from a .env file, add this line there too:"
echo "  LITESTREAM_REPLICA_URL=${REPLICA_URL}"