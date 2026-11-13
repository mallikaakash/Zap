# Sources and verification log

**Last verified:** 2026-11-13 (IST)

## Core documentation

| Resource | URL | Status |
| -------- | --- | ------ |
| NEAR Docs | https://docs.near.org | Active; MCP at https://docs.near.org/mcp |
| Docs repo | https://github.com/near/docs | Maintained |
| NEPs | https://github.com/near/NEPs | Standards source of truth |
| nearcore | https://github.com/near/nearcore | Protocol implementation |
| Awesome NEAR | https://github.com/near/awesome-near | Curated links (verify each link before relying) |

## SDKs and CLIs

| Package | Repo / npm | Verified version (2026-11-13) | Notes |
| ------- | ---------- | ----------------------------- | ----- |
| near-sdk-rs | https://github.com/near/near-sdk-rs | **5.29.1** (this repo workspace) | Primary for contracts |
| near-api-js | https://github.com/near/near-api-js | **7.5.3** (npm latest) | Official JS SDK; skills cover v7 |
| near-cli-rs | https://github.com/near/near-cli-rs | **0.31.1** (installed in setup) | Replaces legacy `near-cli` |
| cargo-near | https://github.com/near/cargo-near | **0.23.0** (local PATH) | Build/deploy helper |
| near-kit | https://github.com/r-near/near-kit | **0.20.2** (repo lockfile) | Used by `@uc/chain` |
| workspaces-js | https://github.com/near/workspaces-js | — | Optional; repo uses `near-sandbox` in Rust |
| workspaces-rs | https://github.com/near/workspaces-rs | — | Repo uses `near-sandbox` 0.3 in tests |
| wallet-selector | https://github.com/near/wallet-selector | — | Planned for seller wallet signing |
| create-near-app | https://github.com/near/create-near-app | — | Scaffold; not used (custom monorepo) |

## Agent infrastructure

| Resource | URL | Status |
| -------- | --- | ------ |
| agent-skills | https://github.com/near/agent-skills | **Installed** under `.agents/skills/` via `skills-lock.json` |
| near-mcp | https://github.com/nearai/near-mcp | npm `@nearai/near-mcp` **0.0.35** pinned in `.cursor/mcp.json` |

## Intents and AI

| Resource | URL | Status |
| -------- | --- | ------ |
| NEAR Intents | https://docs.near-intents.org | Live mainnet API |
| NEAR AI Cloud | https://docs.near.ai | Optional refund assistant (`NEARAI_API_KEY`) |

## Deprecation / migration notes

- **Legacy `near-cli` (Node):** Prefer **near-cli-rs** (Rust binary via npm global).
- **near-api-js v5 patterns:** v7 reorganized exports; use `.agents/skills/near-api-js/` or official migration guides on GitHub releases.
- **`@near-js/*` split packages:** Often consumed via `near-api-js` umbrella in v7.

## Unresolved / verify before production

- Exact NEAR Intents 1Click SLA, rate limits, and asset list churn — check live API + `near-intents` skill.
- Chain Signatures production topology for seller payout-to-EVM (README “Planned”).
- Third-party RPC provider terms (FastNEAR, etc.) if moving off `rpc.mainnet.near.org`.
