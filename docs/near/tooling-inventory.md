# NEAR tooling inventory

**Environment snapshot:** 2026-11-13 — machine used for validation (darwin arm64).

## Runtime (verified)

| Tool | Version | How installed |
| ---- | ------- | ------------- |
| Node.js | v23.5.0 | system |
| pnpm | 10.32.1 | `packageManager` field |
| rustc (system default) | 1.93.1 | rustup |
| Contract toolchain | **1.97.1** | `contracts/rust-toolchain.toml` |
| cargo-near | 0.23.0 | cargo install |
| near-cli-rs | **0.31.1** | `npm install -g` (setup script) |
| wasm32-unknown-unknown | installed | rustup target |

## Monorepo packages (NEAR-related)

| Package | Path | Version / lock |
| ------- | ---- | -------------- |
| near-kit | `packages/chain` | 0.20.2 |
| near-sdk | `contracts/` workspace | 5.29.1 |
| near-sandbox | contract dev-deps | 0.3 |
| near-contract-standards | contracts | 5.29.1 |

## Cursor MCP (`.cursor/mcp.json`)

### near-docs (official, read-mostly)

- **Endpoint:** `https://docs.near.org/mcp`
- **Tools (typical):** `search_near_docs`, `query_docs_filesystem_near_docs`
- **Credentials:** none
- **Risk:** low (remote read-only docs)
- **Verification:** HTTP MCP endpoint listed on docs.near.org (2026-11-13)

### near-mcp (`@nearai/near-mcp`)

- **Source:** https://github.com/nearai/near-mcp
- **Maintainer:** NEAR AI (`nearai`)
- **Pinned npm:** `@nearai/near-mcp@0.0.35`
- **Launch:** `npx -y @nearai/near-mcp@0.0.35 run`
- **Read-only tools:** `account_view_account_summary`, contract view helpers, token search (RPC-backed)
- **High-risk tools:** `system_import_account`, signing/sending transactions, local keystore export
- **Mitigation:** Do not import funded keys; prefer `near-cli-rs` in terminal with human approval; disable block in `mcp.json` if docs-only mode desired
- **Startup:** Server process runs until stopped (stdio MCP); smoke-tested 2026-11-13

### Not enabled (optional)

| MCP | Purpose | Where documented |
| --- | ------- | ---------------- |
| GitHub MCP | Issue/PR search on `near/*` repos | User-level Cursor settings; needs PAT, least privilege |
| near-hydra | Intents + Chain Signatures agent tools | `docs/OPTIONAL_MCP.md` |

## Agent skills

### Official (`.agents/skills/` from `near/agent-skills`)

Tracked in `skills-lock.json`. Refresh: `pnpm skills:update` (root `package.json`).

| Skill | Covers |
| ----- | ------ |
| near-smart-contracts | Rust contracts |
| near-api-js | JS/TS SDK v7 |
| near-kit | near-kit SDK |
| near-cli-rs | CLI one-liners |
| near-dapp | Frontend / wallet |
| near-intents | 1Click API |
| near-contract-audit | Security review |
| near-ai-cloud | NEAR AI inference |

### Project supplements (`.cursor/skills/`)

See each `SKILL.md` — fundamentals, wallet auth, testing, deployment, debugging, chain signatures pointer, TypeScript integration map.

## Cursor rules (`.cursor/rules/`)

| Rule | Scope |
| ---- | ----- |
| `near-development.mdc` | alwaysApply |
| `near-security.mdc` | alwaysApply |
| `rust-contracts.mdc` | `contracts/**` |
| `frontend-dapp.mdc` | `apps/web/**` |

## Config paths

| File | Role |
| ---- | ---- |
| `.cursor/mcp.json` | MCP servers |
| `.env.example` | Template secrets (never commit real `.env`) |
| `contracts/rust-toolchain.toml` | Rust pin |
| `skills-lock.json` | Agent skill hashes |

## Validation commands (2026-11-13)

```bash
pnpm install
pnpm --filter @uc/db generate   # required before core tests
pnpm test                       # 150 TS tests passed
pnpm typecheck                  # all packages OK
pnpm test:contracts             # 13 sandbox tests passed (~114s)
curl -X POST https://rpc.mainnet.near.org -d '{"jsonrpc":"2.0","id":"1","method":"status","params":[]}' ...
near account view-account-summary near network-config mainnet now   # OK (~40s first run)
```
