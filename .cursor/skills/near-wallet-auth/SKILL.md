---
name: near-wallet-auth
description: Authentication patterns for Zap — receipt keys, relayer keys, planned wallet selector. Use for checkout, refund actions, seller dashboard auth, or NEP-413 messaging.
---

# Wallet and auth (this product)

## Customer: receipt keys

1. Generate ed25519 in browser (`packages/chain/src/receipt-key.ts`).
2. Register public key on mint.
3. Sign `(method, args, nonce)`; relay via API → settlement.

**Never** store customer private keys server-side.

## Seller: operator relayer (current)

Executor signs dashboard actions allowed by contract for registered merchant.

**Planned:** Wallet Selector — follow `.agents/skills/near-dapp/`.

## Executor

Function-call key in `services/settlement` only; rotate on compromise.

## NEAR wallet patterns (ecosystem)

For new wallet features, use:

- `.agents/skills/near-dapp/`
- https://github.com/near/wallet-selector

## Security checks

- Verify network before sign
- Show human-readable action summary before wallet prompts
- No seed phrase collection in agent workflows

## Docs

`docs/near/wallets-and-auth.md`

## Testing

Core package tests cover signing helpers; e2e checkout in `scripts/e2e.ts`.
