#!/usr/bin/env bash
set -euo pipefail

echo "==> NEAR hackathon dev setup"

if command -v rustc >/dev/null; then
  echo "Rust: $(rustc --version)"
else
  echo "Install Rust: https://rustup.rs/"
  exit 1
fi

if ! command -v cargo-near >/dev/null; then
  echo "Installing cargo-near..."
  cargo install cargo-near --version 0.21.1 --locked
fi

if ! command -v near >/dev/null; then
  echo "Installing near-cli-rs globally..."
  npm install -g near-cli-rs@latest
fi

if ! command -v node >/dev/null; then
  echo "Install Node.js 22+, 24+, or 26+ (see .nvmrc)"
  exit 1
fi

echo "Node: $(node --version)"

if [ -f .nvmrc ] && command -v nvm >/dev/null 2>&1; then
  # shellcheck disable=SC1090
  source "${NVM_DIR:-$HOME/.nvm}/nvm.sh" 2>/dev/null || true
  nvm use 2>/dev/null || true
fi

npm install
npm install --prefix frontend

echo ""
echo "Optional: enable MCP servers in .cursor/mcp.json and reload Cursor."
echo "Fund testnet NEAR: https://near-faucet.io/"
echo "Done."
