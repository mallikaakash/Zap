#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Universal Checkout / NEAR dev setup"

if command -v rustc >/dev/null; then
  echo "Rust: $(rustc --version)"
else
  echo "Install Rust: https://rustup.rs/"
  exit 1
fi

if ! rustup target list --installed | grep -q wasm32-unknown-unknown; then
  echo "Adding wasm32-unknown-unknown target..."
  rustup target add wasm32-unknown-unknown
fi

if ! command -v cargo-near >/dev/null; then
  echo "Installing cargo-near (see contracts README for expected version)..."
  cargo install cargo-near --locked
fi

if ! command -v near >/dev/null; then
  echo "Installing near-cli-rs globally..."
  npm install -g near-cli-rs@0.31.1
fi

if ! command -v node >/dev/null; then
  echo "Install Node.js 22+ (see .nvmrc)"
  exit 1
fi

echo "Node: $(node --version)"

if [ -f .nvmrc ] && command -v nvm >/dev/null 2>&1; then
  # shellcheck disable=SC1090
  source "${NVM_DIR:-$HOME/.nvm}/nvm.sh" 2>/dev/null || true
  nvm use 2>/dev/null || true
fi

if ! command -v pnpm >/dev/null; then
  echo "Install pnpm 10+ (corepack enable && corepack prepare pnpm@10.32.1 --activate)"
  exit 1
fi

pnpm install
pnpm --filter @uc/db generate

echo ""
echo "MCP: see .cursor/mcp.json and docs/near/tooling-inventory.md — reload Cursor after changes."
echo "Fund testnet NEAR: https://near-faucet.io/"
echo "Quickstart: pnpm demo"
echo "Done."
