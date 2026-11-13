# AI agents — NEAR hackathon workspace

This repository is set up for **human + agent** NEAR Protocol development. Use this file as the map of tools, skills, and safe defaults.

## What is already installed

| Layer | Location / command | Purpose |
| ----- | ------------------- | ------- |
| **NEAR Agent Skills** | `.agents/skills/*` + `skills-lock.json` | Task-specific playbooks (CLI, dApp, contracts, Intents, audit, AI Cloud, near-kit) |
| **NEAR Docs MCP** | `.cursor/mcp.json` → `near-docs` | Live search + doc filesystem (`https://docs.near.org/mcp`) |
| **NEAR blockchain MCP** | `.cursor/mcp.json` → `near-mcp` | Local MCP for accounts/tx/contracts ([nearai/near-mcp](https://github.com/nearai/near-mcp)) — **stores keys locally** |
| **Cursor rules** | `.cursor/rules/` | Project layout, testnet defaults, contract/frontend conventions |
| **Static doc index** | https://docs.near.org/llms.txt | Full doc TOC for `@Docs` or `#fetch` in prompts |

Refresh skills: `npm run skills:update`

## Official skills (read `SKILL.md` before acting)

| Skill | When to use |
| ----- | ----------- |
| `near-dapp` | Scaffold, wallet connect, React/Next patterns |
| `near-smart-contracts` | Rust contract design, storage, XCC, upgrades |
| `near-cli-rs` | Construct complete `near` CLI one-liners |
| `near-api-js` / `near-kit` | JS/TS client calls, keys, tokens |
| `near-intents` | Cross-chain swaps (1Click API) |
| `near-contract-audit` | Pre-deploy security review |
| `near-ai-cloud` | Private / verifiable AI inference on NEAR AI Cloud |

## Repo layout

```
contracts/    # Rust receipt contract + mock USDC (prebuilt wasm in contracts/artifacts/)
packages/     # sdk (pay button), chain, core, db, intents-adapter
apps/web/     # Next.js: checkout, receipt, dashboard, API
services/     # settlement worker
.agents/      # NEAR agent skills (do not hand-edit; use skills CLI to update)
```
Read CLAUDE.md, SPEC.md and DECISIONS.md first. `pnpm demo` runs everything locally.

## Typical agent workflows

### Read chain / contract state (no keys)

```bash
near contract call-function as-read-only <contract.testnet> <method> json-args '{}' network-config testnet now
```

### Build & test contract

```bash
pnpm build:contracts
pnpm test:contracts
```

### Frontend dev server

```bash
pnpm dev
```

Requires Node **≥ 22** (see `.nvmrc`). Run `nvm use` in this directory.

Before tests: `pnpm --filter @uc/db generate`

### Deploy (human approves signing)

See `docs/GO-LIVE.md` and `docs/near/deployment.md`. Never auto-import seed phrases into MCP or git.

## NEAR knowledge base

Structured docs for agents: **`docs/near/`** (start at `docs/near/README.md`).

Project skills (supplements): **`.cursor/skills/`** — fundamentals, wallet auth, deployment, debugging, etc.

## NEAR CLI (terminal)

Install: `bash scripts/setup.sh` or `npm install -g near-cli-rs@0.31.1`

Faucet (browser): https://near-faucet.io/

## Optional ecosystem tools (not bundled)

- **[near-hydra](https://github.com/near/near-hydra)** — CLI + MCP for Chain Signatures and NEAR Intents across many chains
- **[cargo-near](https://github.com/near/cargo-near)** — contract build/deploy helper (expected in `PATH` for `contract/`)
- **NEAR AI Cloud** — see `near-ai-cloud` skill and https://docs.near.ai/

## Security rules for agents

1. Default to **testnet**; confirm before mainnet or real funds.
2. Never commit `.env`, keystores, or mnemonic material.
3. Treat `near-mcp` `import_account` as high risk (user must explicitly supply keys).
4. Run contract-audit skill guidance before production deploys.

## Human docs

See [README.md](./README.md) for install steps and hackathon quickstart.
