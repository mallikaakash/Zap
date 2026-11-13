#!/bin/sh
# Container entrypoint (Cloud Run). Keeps the SQLite database across deploys with Litestream:
#   1. restore .uc/live.db from the replica if this container has no database yet
#   2. run the app under `litestream replicate`, which streams every change to the replica
#      and does a final sync when Cloud Run stops the container.
# Without LITESTREAM_REPLICA_URL the app runs as before (the database lives only in this container).
set -eu

DB="${UC_DB_PATH:-/app/.uc/live.db}"
# `exec` so the app itself gets the stop signal. Override for tests with UC_START_CMD.
START="${UC_START_CMD:-exec pnpm start -- --no-build}"
export UC_DB_PATH="$DB"
mkdir -p "$(dirname "$DB")"

if [ -n "${LITESTREAM_REPLICA_URL:-}" ]; then
  echo "[entrypoint] restoring $DB from the replica (skipped if a local database exists or no replica yet)"
  litestream restore -config /app/scripts/litestream.yml -if-db-not-exists -if-replica-exists "$DB"
  echo "[entrypoint] starting the app with continuous replication"
  # litestream -exec does not use a shell, so hand it a script that does
  RUN=/tmp/uc-start.sh
  printf '%s\n' '#!/bin/sh' "$START" > "$RUN"
  exec litestream replicate -config /app/scripts/litestream.yml -exec "sh $RUN"
fi

echo "[entrypoint] LITESTREAM_REPLICA_URL is not set: the database is NOT persisted and a new revision starts empty"
exec sh -c "$START"
