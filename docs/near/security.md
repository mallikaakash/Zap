# Security — blockchain development

Treat **mainnet funds** and **operator keys** as production secrets. This prototype is **unaudited**.

## Key management

| Asset | Storage | Rule |
| ----- | ------- | ---- |
| Customer receipt private key | Browser memory / optional export UX | Never sent to server except as signature |
| Executor access key | Deployment env, settlement service | Function-call scope only; rotate if leaked |
| Operator seed / key | Deployment host only | Never in git, MCP import, or chat logs |
| near-mcp local keystore | User machine running MCP | Do not import funded mainnet accounts |

## Agent / MCP safeguards

- `.cursor/rules/near-security.mdc` always on
- Disable `near-mcp` in `.cursor/mcp.json` for docs-only sessions
- Ban `system_import_account` without explicit user request
- Prefer `account_view_*` and RPC read tools

## Smart contract

- Authorization on every `#[call]` mutator (owner, merchant, receipt key, pause)
- **Escrow invariants:** USDC assigned ≤ balance; refunds ≤ unreleased
- **Replay:** nonces on receipt-key signed actions
- **Callbacks:** handle `PromiseResult` failures; no stuck funds
- **Upgrades:** owner-only; migration plan required

## Off-chain / relayer

- Executor cannot approve refunds above on-chain caps
- Attribute `mint_receipt` only to unmatched USDC (trust assumption — document on `/verify`)
- Webhook HMAC (`X-UC-Signature`) — see root README

## Cross-contract / Intents

- Validate quote IDs and amounts before marking refund delivered
- Do not trust client-reported swap success without executor confirmation

## Development practices

- Testnet-first; mainnet deploy only via `docs/GO-LIVE.md` with human `--yes`
- Run `.agents/skills/near-contract-audit/` before contract changes affecting funds
- No hardcoded API keys in source

## Threats introduced by this setup

| Risk | Mitigation applied |
| ---- | ------------------ |
| near-mcp signing tools | Pin version; document risk; security rule |
| Global near-cli install | User PATH only; no keys by default |
| Simulated Intents hide quote failures | UI badge + docs distinguish live vs local |

## Incident response (operator)

1. Pause contract (`pause` methods per INTERFACE)
2. Rotate executor keys on NEAR account
3. Invalidate dashboard links / webhook secrets
