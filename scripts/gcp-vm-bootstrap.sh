#!/usr/bin/env bash
# Bootstrap Universal Checkout on a Debian/Ubuntu GCP VM (run ON the VM).
# Usage:
#   sudo bash scripts/gcp-vm-bootstrap.sh demo   # HTTPS + local sandbox (no .env)
#   sudo bash scripts/gcp-vm-bootstrap.sh live   # requires repo-root .env (chmod 600)

set -euo pipefail

MODE="${1:-demo}"
REPO="${REPO:-/opt/zap}"
PUBLIC_HOST="${PUBLIC_HOST:-34-69-143-151.sslip.io}"
PUBLIC_URL="${PUBLIC_URL:-https://${PUBLIC_HOST}}"
APP_USER="${APP_USER:-violinadoley}"

echo "==> mode=$MODE repo=$REPO public=$PUBLIC_URL"

# Stop legacy processes
pkill -f "/opt/universal-checkout" 2>/dev/null || true
pkill -f "scripts/demo.ts" 2>/dev/null || true
sleep 2

if ! command -v git >/dev/null; then
  apt-get update -qq && apt-get install -y git curl
fi

if [[ ! -d "$REPO/.git" ]]; then
  rm -rf "$REPO"
  git clone https://github.com/mallikaakash/Zap.git "$REPO"
fi

cd "$REPO"
git fetch origin main && git checkout main && git pull --ff-only origin main
chown -R "$APP_USER:$APP_USER" "$REPO"

sudo -u "$APP_USER" bash -lc "cd '$REPO' && corepack enable 2>/dev/null || true && pnpm install"

# Caddy + TLS
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y caddy
fi

cat > /etc/caddy/Caddyfile <<EOF
${PUBLIC_HOST} {
    reverse_proxy 127.0.0.1:3000
}
EOF
systemctl enable caddy
systemctl reload caddy

# systemd service
if [[ "$MODE" == "live" ]]; then
  if [[ ! -f "$REPO/.env" ]]; then
    echo "Missing $REPO/.env — copy from deploy:mainnet on your laptop first."
    exit 1
  fi
  chmod 600 "$REPO/.env"
  EXEC_START="/usr/bin/pnpm start"
  DESC="Universal Checkout (live mainnet)"
else
  EXEC_START="/usr/bin/env PUBLIC_URL=${PUBLIC_URL} /usr/bin/pnpm demo"
  DESC="Universal Checkout (HTTPS sandbox demo)"
fi

PNPM="$(command -v pnpm)"
NODE_BIN="$(dirname "$(command -v node)")"

cat > /etc/systemd/system/uc-checkout.service <<EOF
[Unit]
Description=${DESC}
After=network-online.target caddy.service
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${REPO}
Environment=PATH=${NODE_BIN}:/usr/bin
Environment=PORT=3000
ExecStart=${EXEC_START}
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable uc-checkout
systemctl restart uc-checkout

echo "==> Waiting for app (up to 3 min on first sandbox download)…"
for i in $(seq 1 36); do
  if curl -sf "http://127.0.0.1:3000/api/dev/state" >/dev/null 2>&1; then
    curl -s "http://127.0.0.1:3000/api/dev/state" | head -c 200
    echo ""
  break
  fi
  sleep 5
done

curl -sf "https://${PUBLIC_HOST}/api/dev/state" && echo "" || echo "HTTPS check failed — see journalctl -u uc-checkout -f"

echo "==> Done. Logs: journalctl -u uc-checkout -f"
