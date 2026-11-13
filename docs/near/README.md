# NEAR knowledge base (Zap workspace)

Structured reference for humans and Cursor agents working on **Zap** (Zap): NEAR smart contracts, Intents, TypeScript stack, and operator tooling.

**Verification date:** 2026-11-13  
**Primary official sources:** [docs.near.org](https://docs.near.org), [NEAR Intents docs](https://docs.near-intents.org/), [near/agent-skills](https://github.com/near/agent-skills)

## How to use this folder

| Document | Purpose |
| -------- | ------- |
| [architecture.md](./architecture.md) | How this repo maps to NEAR + Intents |
| [developer-guide.md](./developer-guide.md) | Day-one commands and conventions |
| [smart-contracts.md](./smart-contracts.md) | Rust/near-sdk patterns used here |
| [wallets-and-auth.md](./wallets-and-auth.md) | Receipt keys, relayer, future wallet selector |
| [intents.md](./intents.md) | 1Click, live vs mock adapter |
| [chain-signatures.md](./chain-signatures.md) | Multichain signing (ecosystem; not core to MVP) |
| [security.md](./security.md) | Threat model and agent rules |
| [testing.md](./testing.md) | TS + Rust + sandbox matrix |
| [deployment.md](./deployment.md) | Local demo vs mainnet go-live |
| [tooling-inventory.md](./tooling-inventory.md) | Versions, MCP, CLI, skills |
| [sources.md](./sources.md) | URLs, verification notes, deprecations |

## Grounding order for agents

1. `.cursor/rules/` and `AGENTS.md`
2. `near-docs` MCP or https://docs.near.org/llms.txt
3. `.agents/skills/<topic>/SKILL.md`
4. `.cursor/skills/<topic>/SKILL.md` (project supplements)
5. `contracts/INTERFACE.md`, `DECISIONS.md`, `SPEC.md`

## Repo-specific facts (verified)

- **Product:** Escrow receipt NFTs (NEP-171) holding USDC during refund window; NEAR Intents for cross-chain pay-in/refund-out.
- **Local dev:** `pnpm demo` — NEAR sandbox + **simulated** Intents (`packages/intents-adapter/src/mock.ts`).
- **Live Intents:** Mainnet only; no NEAR Intents testnet (documented in root `README.md`).
- **JS NEAR client:** `near-kit` 0.20.2 in `packages/chain` (not `near-api-js` in the dependency tree today).
- **Contracts:** `near-sdk` 5.29.1, toolchain 1.97.1 per `contracts/rust-toolchain.toml`.
