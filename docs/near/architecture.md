# Architecture — NEAR layer (this repository)

**Status:** Verified against repo layout 2026-11-13. Product logic in `SPEC.md` / `DECISIONS.md`.

## System context

Zap is a **hosted checkout + escrow contract** on NEAR Mainnet (live) or **NEAR Sandbox** (local). Cross-chain pay-in/out uses **NEAR Intents 1Click** on mainnet; local mode uses a **mock intents adapter**.

```
                    ┌─────────────────┐
  Customer browser  │  apps/web       │  Sessions, checkout UI, receipt page
        │           │  packages/sdk   │  <pay-button> web component
        │           └────────┬────────┘
        │                    │ signed actions (receipt key)
        ▼                    ▼
                    ┌─────────────────┐
                    │ services/       │  Executor: function-call key, gas payer
                    │  settlement     │  mint_receipt, refunds, releases
                    └────────┬────────┘
                             │ near-kit JSON-RPC
                             ▼
                    ┌─────────────────┐
                    │ NEAR chain      │  receipts contract (NEP-171 + escrow)
                    │ + USDC NEP-141  │  mock-usdc on sandbox
                    └────────┬────────┘
                             │ mainnet only
                             ▼
                    ┌─────────────────┐
                    │ NEAR Intents    │  1Click quotes/swaps (live adapter)
                    │ 1Click API      │
                    └─────────────────┘
```

## On-chain components

| Artifact | Path | Role |
| -------- | ---- | ---- |
| Receipt contract | `contracts/receipts` | Escrow USDC, NFT receipts, refund state machine |
| Mock USDC | `contracts/mock-usdc` | Sandbox faucet token |
| Prebuilt WASM | `contracts/artifacts/` | Demo without local Rust build |
| Interface spec | `contracts/INTERFACE.md` | Methods, events, invariants |

**Standards:** NEP-171 (receipt NFT), NEP-141 (USDC transfers), custom receipt-key authorization (ed25519 message format in `packages/chain`).

## Off-chain components

| Package | NEAR responsibility |
| ------- | ------------------- |
| `@uc/chain` | RPC, nonce, relay signed calls |
| `@uc/core` | Business logic, settlement orchestration |
| `@uc/intents-adapter` | Quote/execute swaps (real or mock) |
| `@uc/db` | Orders, sessions (SQLite/Prisma) |

## Trust boundaries (architectural)

1. **Customer receipt key** — private key stays in browser; contract stores public key only.
2. **Executor** — can attribute incoming USDC to orders (`mint_receipt`); holds limited access key; cannot drain arbitrary user funds beyond defined contract methods.
3. **Operator** — registers merchants; dashboard actions signed by relayer today (seller wallet signing planned).

## Network modes

| Mode | Chain | Intents | Entrypoint |
| ---- | ----- | ------- | ---------- |
| local | Sandbox | Mock | `pnpm demo` |
| live | Mainnet | Real 1Click | `pnpm deploy:mainnet` + `pnpm start` |

**Recommendation:** Treat sandbox + mock as the only safe default for agents; mainnet requires explicit operator approval (`docs/GO-LIVE.md`).

## Experimental / planned (not implemented)

- Wallet Selector for seller-signed settings
- Chain Signatures for seller payout to non-NEAR chains
- TEE-hosted settlement worker (OutLayer)
- WooCommerce / MCP merchant integrations

See [intents.md](./intents.md) and [chain-signatures.md](./chain-signatures.md) for ecosystem depth.
