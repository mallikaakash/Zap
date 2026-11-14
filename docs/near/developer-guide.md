# Developer guide

## Prerequisites

- Node **≥ 22** (see `.nvmrc`)
- pnpm **10.32.1** (`corepack enable`)
- Rust **1.97.1** for contract work (`contracts/rust-toolchain.toml`)
- Optional: `near-cli-rs`, `cargo-near` — `bash scripts/setup.sh`

## First run (no keys)

```bash
pnpm install
pnpm --filter @uc/db generate
pnpm demo
```

Opens sandbox, deploys artifacts, starts web + settlement worker.

## Everyday commands

| Command | Purpose |
| ------- | ------- |
| `pnpm test` | Vitest across packages |
| `pnpm typecheck` | TypeScript |
| `pnpm test:contracts` | Rust unit + sandbox (~2 min first time) |
| `pnpm build:contracts` | WASM via `scripts/build-contracts.sh` |
| `pnpm dev` | Dev stack (see `scripts/dev.ts`) |
| `pnpm skills:update` | Refresh `.agents/skills` from `near/agent-skills` |

## Reading order for new contributors

1. Root `README.md` — product and trust model
2. `docs/near/architecture.md`
3. `contracts/INTERFACE.md`
4. `DECISIONS.md`

## Agent-oriented workflows

### Grounding

- Enable MCP in Cursor: reload after editing `.cursor/mcp.json`
- Prefer `near-docs` MCP for API semantics
- Read `.agents/skills/<topic>/SKILL.md` before generating CLI or contract code

### View call (testnet/mainnet, no keys)

```bash
near contract call-function as-read-only <account.near> <method> \
  json-args '{}' network-config testnet now
```

### Contract edit loop

1. Change `contracts/receipts/src/*.rs`
2. `cd contracts && cargo test --locked`
3. `pnpm build:contracts` if WASM artifacts needed for demo deploy

### TypeScript edit loop

1. Change `packages/*` or `apps/web/*`
2. `pnpm typecheck` + `pnpm test`

## Environment variables

Copy `.env.example` → `.env`. Never commit `.env`. Mainnet operator key material only on deployment host.

## Common pitfalls (this repo)

| Issue | Fix |
| ----- | --- |
| `Cannot find module '.prisma/client/default'` | `pnpm --filter @uc/db generate` |
| Intents fail on testnet | Expected — use local mock or mainnet (`README.md`) |
| Rules mention `contract/` or `frontend/` | Legacy hackathon scaffold — use `contracts/`, `apps/web/` |

## Official references

- Accounts & keys: https://docs.near.org/concepts/basics/accounts/introduction
- Transactions: https://docs.near.org/concepts/basics/transactions
- SDK (Rust): https://docs.near.org/sdk/rust/introduction
