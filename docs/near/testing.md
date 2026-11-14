# Testing

## Matrix (verified 2026-11-13)

| Layer | Command | Result |
| ----- | ------- | ------ |
| intents-adapter | `pnpm test` (package) | 45 passed, 3 skipped |
| sdk | `pnpm test` (package) | 92 passed |
| core | `pnpm test` (package) | 13 passed (after `prisma generate`) |
| Full workspace | `pnpm test` | OK |
| TypeScript | `pnpm typecheck` | OK |
| Contracts | `pnpm test:contracts` | 13 sandbox tests OK |

## Prerequisites

```bash
pnpm install
pnpm --filter @uc/db generate
```

## Contract testing

- **Unit tests:** `contracts/receipts/src/tests.rs`
- **Sandbox:** `near-sandbox` + `tokio` in `contracts/receipts/tests/sandbox.rs`
- First sandbox run downloads toolchain artifacts; ~2 minutes wall time observed.

```bash
cd contracts && cargo test --locked
```

## TypeScript testing

- Vitest per package (`vitest run` in package scripts)
- No default e2e in `pnpm test` — `pnpm test:e2e` via `scripts/e2e.ts` (heavier)

## What is not covered in CI by default

- Real NEAR Intents HTTP (mock only)
- Mainnet deploy scripts
- Wallet selector flows (not shipped)

## Agent requirements

- Run contract tests when touching `contracts/**`
- Run `pnpm test` when touching settlement, core, or checkout logic
- Do not claim green builds without running commands

## near-workspaces / workspaces-js

Official alternatives to `near-sandbox`; this repo standardized on **Rust near-sandbox** for receipts. For new services, evaluate `near-kit` sandbox helpers in skill docs.

## RPC smoke test (read-only)

```bash
curl -s -X POST https://rpc.mainnet.near.org \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"1","method":"status","params":[]}'
```

Expected: `chain_id":"mainnet"`, current `protocol_version`.
