#!/usr/bin/env bash
# Apply Gmail (or any SMTP) vars to Cloud Run service zap. Secrets stay local — never commit .env.smtp.
# 1. Copy .env.smtp.example → .env.smtp and fill SMTP_USER, SMTP_PASS, EMAIL_FROM
# 2. bash scripts/smtp-cloudrun.sh
set -euo pipefail

PROJECT="${GCP_PROJECT:-project-bf77a013-c0b3-413c-a75}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${RUN_SERVICE:-zap}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${SMTP_ENV_FILE:-$ROOT/.env.smtp}"
REMOVE_RESEND="${REMOVE_RESEND:-1}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy .env.smtp.example and add SMTP_USER, SMTP_PASS, EMAIL_FROM" >&2
  exit 1
fi

# shellcheck disable=SC1090
source <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" | sed 's/^/export /')

for v in SMTP_USER SMTP_PASS EMAIL_FROM; do
  if [[ -z "${!v:-}" ]]; then
    echo "Set $v in $ENV_FILE" >&2
    exit 1
  fi
done

# gcloud comma escaping: double quotes inside values
esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
VARS="SMTP_USER=$(esc "$SMTP_USER"),SMTP_PASS=$(esc "${SMTP_PASS// /}"),EMAIL_FROM=$(esc "$EMAIL_FROM")"

echo "==> Updating $SERVICE (SMTP + EMAIL_FROM)"
CMD=(gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" "--update-env-vars=$VARS" --quiet)
if [[ "$REMOVE_RESEND" == "1" ]]; then
  echo "==> Removing RESEND / RESEND_API_KEY so SMTP is the only outbound path"
  CMD+=(--remove-env-vars=RESEND,RESEND_API_KEY)
fi
"${CMD[@]}"

URL="$(gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format='value(status.url)')"
echo "==> Done. Test: sign up at ${URL}/dashboard with a real email; Notifications should show sent."
echo "    Litestream is unchanged — database survives this restart."