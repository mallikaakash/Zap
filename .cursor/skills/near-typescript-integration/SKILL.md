---
name: near-typescript-integration
description: TypeScript NEAR clients in this monorepo — near-kit in @uc/chain, API patterns, RPC, and when to use near-api-js skill. Use for packages/chain, settlement worker, and web API routes.
---

# TypeScript integration (this repo)

## Primary library

**near-kit 0.20.2** in `packages/chain` — not `near-api-js` in production dependencies.

Read `.agents/skills/near-kit/SKILL.md` for API patterns; use `.agents/skills/near-api-js/` when adding wallet-selector or near-api-js directly.

## Layout

| Path | Role |
| ---- | ---- |
| `packages/chain/src/index.ts` | NEAR client wiring |
| `packages/chain/src/receipt-key.ts` | ed25519 signing |
| `services/settlement` | Submits relayed transactions |
| `apps/web/app/api/**` | HTTP boundary |

## Patterns

- **View:** RPC read via near-kit; cache in tests sparingly
- **Call:** Executor signs with stored key; customers sign via receipt-key payload
- **Units:** USDC 6 decimals; NEAR yocto strings in near-kit/near-api-js

## Testing

`pnpm typecheck` and package-level `vitest`.

## Security

- No private keys in `apps/web` bundle
- Executor key only in settlement service env

## Official docs

https://docs.near.org/tools/near-api (concepts apply across SDKs)

## Version info

`docs/near/tooling-inventory.md`; npm `near-api-js` latest 7.5.3 for greenfield modules.
