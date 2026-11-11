# NEAR hackathon starter

A **ready-to-build** NEAR Web3 workspace: Rust smart contract, Vite + React frontend with wallet connect, **official NEAR Agent Skills**, and **Cursor MCP** integrations for docs and (optional) on-chain operations.

## What's inside

- **`contract/`** — Basic auction Rust contract (from `create-near-app`), sandbox integration tests, `cargo-near` build output under `target/near/`.
- **`frontend/`** — Vite + React app with `@hot-labs/near-connect`, `near-api-js`, and example routes.
- **`.agents/skills/`** — All skills from [near/agent-skills](https://github.com/near/agent-skills) (CLI, dApp, contracts, Intents, audit, AI Cloud, near-kit).
- **`.cursor/mcp.json`** — [NEAR Docs MCP](https://docs.near.org/mcp) + optional [@nearai/near-mcp](https://github.com/nearai/near-mcp).

AI contributors should read **[AGENTS.md](./AGENTS.md)** first.

## Prerequisites

| Tool | Purpose |
| ---- | ------- |
| [Node.js](https://nodejs.org/) 22.22+, 24.15+, or **26+** | Frontend (`nvm use` reads `.nvmrc`) |
| [Rust](https://rustup.rs/) | Smart contracts |
| [cargo-near](https://github.com/near/cargo-near) | Build/deploy WASM |
| [near-cli-rs](https://near.cli.rs) | Accounts, tokens, contract calls |

One-shot setup script:

```bash
./scripts/setup.sh
```

## Quickstart

```bash
nvm use                    # or install Node 26+
npm install                # root helper scripts
npm run dev                # frontend → http://localhost:5173

npm run build:contract     # WASM in contract/target/near/
npm run test:contract      # sandbox tests (can take ~2 min)
```

### Testnet account

1. Create an account with NEAR CLI or the [faucet](https://near-faucet.io/).
2. Copy `.env.example` → `.env` and fill in account IDs (do not commit `.env`).
3. Deploy: follow [contract/README.md](./contract/README.md).
4. Point the UI at your contract in `frontend/src/config.ts`.

## AI & agent features (NEAR official)

| Feature | Link |
| ------- | ---- |
| Tools for AI agents | https://docs.near.org/getting-started/tools-for-ai |
| Agent Skills repo | https://github.com/near/agent-skills |
| Docs MCP | https://docs.near.org/mcp |
| llms.txt doc index | https://docs.near.org/llms.txt |
| NEAR MCP (local keys) | https://github.com/nearai/near-mcp |

Update project skills:

```bash
npm run skills:update
```

### Cursor tips

- Enable MCP servers from `.cursor/mcp.json` (reload window after edit).
- Add **Docs** source: `https://docs.near.org/llms.txt` for inline doc context.
- Project rules live in `.cursor/rules/`.

## Project scripts

| Script | Action |
| ------ | ------ |
| `npm run dev` | Start Vite frontend |
| `npm run build:contract` | `cargo near build` |
| `npm run test:contract` | Rust sandbox tests |
| `npm run build:frontend` | Production frontend build |
| `npm run setup` | Install global CLI tools (see script) |
| `npm run skills:update` | Refresh `.agents/skills` |

## Learn more

- [Web3 app quickstart](https://docs.near.org/web3-apps/quickstart)
- [Basic auction tutorial](https://docs.near.org/tutorials/auction/basic-auction)
- [NEAR awesome list](https://github.com/near/awesome-near)

## License

Contract and frontend scaffolding follow NEAR example templates; hackathon meta-docs are MIT-compatible — check per-package licenses in `frontend/package.json` and `contract/Cargo.toml`.
