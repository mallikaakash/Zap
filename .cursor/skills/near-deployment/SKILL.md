---
name: near-deployment
description: Deploy Zap locally or mainnet — demo sandbox, build-contracts, GO-LIVE, near-cli-rs. Use for release operations, never without human approval on mainnet.
---

# near-deployment

## Local

`pnpm demo` — uses `contracts/artifacts/`

## WASM build

`pnpm build:contracts` — needs Rust toolchain from `contracts/rust-toolchain.toml`

## Mainnet

**Human gate required.** Follow `docs/GO-LIVE.md` and `docs/near/deployment.md`.

```bash
pnpm deploy:mainnet   # requires --yes
```

## CLI

`.agents/skills/near-cli-rs/SKILL.md` — full non-interactive commands.

## Agents

Do not run deploy or fund accounts unless user explicitly requests in-chat.
