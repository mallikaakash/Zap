#!/usr/bin/env bash
# One-shot: upload a local SQLite file into the Litestream GCS replica (replaces prior generations).
# Usage: bash scripts/litestream-seed.sh [path-to-live.db]
set -euo pipefail

PROJECT="${GCP_PROJECT:-project-bf77a013-c0b3-413c-a75}"
BUCKET="${LITESTREAM_BUCKET:-zap-db-${PROJECT}}"
REPLICA="gcs://${BUCKET}/zap/live.db"
DB="${1:-}"

if [[ -z "$DB" ]]; then
  echo "Usage: $0 /path/to/live.db" >&2
  exit 1
fi
if [[ ! -f "$DB" ]]; then
  echo "Missing file: $DB" >&2
  exit 1
fi
# Container image uses Litestream 0.3.x (gcs:// replicas). Homebrew may ship 0.5+ with a different URL scheme.
LITESTREAM_BIN="${LITESTREAM_BIN:-}"
if [[ -z "$LITESTREAM_BIN" ]]; then
  ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  CACHE="$ROOT/.uc/litestream-v0.3.13"
  ARCH="$(uname -m)"
  case "$ARCH" in
    arm64) ZIP=litestream-v0.3.13-darwin-arm64.zip ;;
    x86_64) ZIP=litestream-v0.3.13-darwin-amd64.zip ;;
    *) echo "Unsupported arch for bundled litestream: $ARCH" >&2; exit 1 ;;
  esac
  if [[ ! -x "$CACHE/litestream" ]]; then
    mkdir -p "$CACHE"
    curl -fsSL -o "$CACHE.zip" "https://github.com/benbjohnson/litestream/releases/download/v0.3.13/$ZIP"
    unzip -o -q "$CACHE.zip" -d "$CACHE"
    chmod +x "$CACHE/litestream"
  fi
  LITESTREAM_BIN="$CACHE/litestream"
fi

echo "==> Clearing old replica objects under gs://${BUCKET}/zap/live.db/"
gcloud storage rm -r "gs://${BUCKET}/zap/live.db/**" --quiet 2>/dev/null || true

echo "==> Writing initial snapshot from $DB to $REPLICA (using $LITESTREAM_BIN)"
"$LITESTREAM_BIN" replicate "$DB" "$REPLICA" &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do
  if gcloud storage ls "gs://${BUCKET}/zap/live.db/generations/**/snapshots/*.lz4" &>/dev/null; then
    echo "==> Snapshot visible in GCS"
    break
  fi
  sleep 1
done
kill $PID 2>/dev/null || true
wait $PID 2>/dev/null || true
trap - EXIT

echo "==> Done. Redeploy Cloud Run with LITESTREAM_REPLICA_URL=$REPLICA (see litestream-bootstrap.sh)."