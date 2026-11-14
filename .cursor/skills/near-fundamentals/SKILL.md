---
name: near-fundamentals
description: NEAR accounts, keys, transactions, gas, RPC, and networks. Use when explaining protocol concepts, choosing testnet vs mainnet vs sandbox, or before writing chain integration code in Zap.
---

# NEAR fundamentals (Zap)

## Activation

Protocol questions, account models, gas/deposits, finality, RPC endpoints, or when official docs must ground an answer.

## Trusted sources

- https://docs.near.org/llms.txt (TOC)
- `near-docs` MCP: `search_near_docs`
- `docs/near/developer-guide.md`, `docs/near/sources.md`

## Core concepts (quick reference)

**Accounts:** Named (`*.near`, `*.testnet`) or implicit (64-char hex). Subaccounts controlled by parent.

**Keys:** Full-access vs function-call (method allowlist + optional NEAR allowance). Least privilege for relayers.

**Transactions:** Batch of actions; each consumes gas. Attach NEAR deposits for storage or payable methods.

**Receipts:** Async execution unit; cross-contract calls use promises + callbacks.

**Gas:** Prepaid on function calls; attach extra for XCC. Use `teraToGas` helpers in JS SDK skill.

**Networks:** mainnet, testnet, local sandbox (this repo's `pnpm demo`).

**JSON-RPC:** `view_*` methods are read-only; `broadcast_tx_*` changes state.

## This repo defaults

- Dev: **sandbox** + mock Intents
- Live product: **mainnet** only for Intents
- Never invent RPC methods — verify in NEAR docs

## Security checks

- Confirm `networkId` on every CLI/SDK call
- View vs call separation in APIs

## Common mistakes

- Assuming testnet Intents parity (none)
- Using implicit account rules for named merchant IDs
- Ignoring callback failure after XCC

## Versions

See `docs/near/tooling-inventory.md` (verified 2026-11-13).
