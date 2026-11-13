#!/usr/bin/env bash
# Deploy Universal Checkout to Cloud Run with automatic HTTPS (*.run.app).
set -euo pipefail

PROJECT="${GCP_PROJECT:-project-bf77a013-c0b3-413c-a75}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${RUN_SERVICE:-zap}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-}"

cd "$ROOT"

if [[ -z "$ENV_FILE" ]]; then
  ENV_FILE="$(mktemp -t uc-cloudrun-env)"
  trap 'rm -f "$ENV_FILE"' EXIT
  gcloud compute scp uc-checkout:/opt/zap/.env "$ENV_FILE" --zone=us-central1-a --project="$PROJECT"
fi

# Cloud Run env-vars-file expects YAML (KEY: value).
ENV_YAML="$(mktemp -t uc-cloudrun-yaml)"
trap 'rm -f "$ENV_FILE" "$ENV_YAML" "${ENV_YAML}.bak" 2>/dev/null' EXIT
{
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    line="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [[ -z "$line" ]] && continue
    key="${line%%=*}"
    val="${line#*=}"
    [[ "$key" == "PORT" ]] && continue
    # YAML-escape double quotes in values
    val="${val//\"/\\\"}"
    echo "${key}: \"${val}\""
  done < <(grep -v '^[[:space:]]*#' "$ENV_FILE" | grep -v '^[[:space:]]*$')
} > "$ENV_YAML"

echo "==> Building and deploying $SERVICE to $REGION (project $PROJECT)"
gcloud run deploy "$SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --source="$ROOT" \
  --allow-unauthenticated \
  --port=8080 \
  --min-instances=1 \
  --max-instances=1 \
  --no-cpu-throttling \
  --memory=1Gi \
  --cpu=1 \
  --timeout=300 \
  --env-vars-file="$ENV_YAML"

URL="$(gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format='value(status.url)')"
SHORT="$(gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format='value(status.address.url)' 2>/dev/null || true)"
echo "==> URL: $URL"

if grep -q 'PUBLIC_URL:' "$ENV_YAML"; then
  sed -i.bak "s|^PUBLIC_URL:.*|PUBLIC_URL: \"${URL}\"|" "$ENV_YAML"
  gcloud run services update "$SERVICE" \
    --project="$PROJECT" \
    --region="$REGION" \
    --env-vars-file="$ENV_YAML"
  echo "==> PUBLIC_URL set to $URL"
fi

echo "==> Smoke: curl -s ${URL}/api/dev/state"
