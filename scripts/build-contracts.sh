#!/usr/bin/env bash
# Builds both contracts with cargo-near and copies the wasm to contracts/artifacts/.
# Needs: rustup (toolchain pinned in contracts/rust-toolchain.toml) and cargo-near >= 0.21.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS="$ROOT/contracts"
ARTIFACTS="$CONTRACTS/artifacts"

if ! cargo near --version >/dev/null 2>&1; then
  echo "cargo-near is not installed. Run: cargo install cargo-near --locked" >&2
  exit 1
fi

mkdir -p "$ARTIFACTS"
for crate in receipts mock-usdc; do
  name="${crate//-/_}"
  echo "==> building $crate"
  (cd "$CONTRACTS/$crate" && cargo near build non-reproducible-wasm)
  cp "$CONTRACTS/target/near/$name/$name.wasm" "$ARTIFACTS/$name.wasm"
done

echo "==> artifacts"
(cd "$ARTIFACTS" && ls -l ./*.wasm && shasum -a 256 ./*.wasm)
chmod 644 "$ARTIFACTS"/*.wasm
