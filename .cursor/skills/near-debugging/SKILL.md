---
name: near-debugging
description: Debug NEAR issues — RPC, receipts, near-cli-rs logs, sandbox, settlement worker. Use for failed transactions, contract panics, or attribution bugs.
---

# near-debugging

## Read-only first

```bash
near contract call-function as-read-only <id> <method> json-args '{}' network-config testnet now
```

RPC status:

```bash
curl -s -X POST https://rpc.testnet.near.org -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"1","method":"EXPERIMENTAL_tx_status","params":["<TX_BASE58>","<signer>"]}'
```

## Local

- Re-run `pnpm demo` with logs from settlement worker
- `cargo test --locked -- --nocapture` for contract failures

## MCP

- `near-docs` for method semantics
- `near-mcp` view tools only unless user approves signing

## This product

- Check `/verify/:id` for escrow coverage
- Compare mock vs live Intents (`docs/near/intents.md`)

## Common mistakes

- Missing `prisma generate` masquerading as chain bug
- Assuming swap success without executor log + on-chain USDC
