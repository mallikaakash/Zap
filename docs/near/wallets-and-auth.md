# Wallets and authentication

## Ecosystem overview (verified concepts)

| Mechanism | Use case | Docs |
| --------- | -------- | ---- |
| Wallet Selector | Browser wallet connect (MyNearWallet, Meteor, etc.) | https://github.com/near/wallet-selector |
| NEAR Connect | Hot Labs connector used in many new dApps | `near-dapp` skill |
| Implicit accounts | Key-derived account IDs | NEAR docs — accounts |
| NEP-413 / sign message | Off-chain auth | `near-api-js` skill |
| Function-call keys | Relayers, automation | NEAR docs — access keys |

## What this product uses today

### Customers — receipt keys (not a NEAR wallet)

1. Browser generates **ed25519** key pair (`packages/chain/src/receipt-key.ts`).
2. Only **public key** stored on-chain with the receipt NFT.
3. Customer signs structured payloads (method + args + nonce); **server/executor relays** transaction and pays gas.

**Security properties:**

- No seed phrase in checkout flow
- Signatures bind to specific contract method parameters
- Compromise of relay cannot forge customer signatures without private key

### Sellers — operator relayer (interim)

- Onboarding via operator dashboard; merchant NEAR account registered on-chain by executor.
- Dashboard approve/deny/refund actions signed with **executor key** within contract rules.
- **Planned:** sellers sign via wallet selector (`README.md`).

### Executor (`services/settlement`)

- Holds **function-call** access key(s) for contract methods allowed by deployment.
- Must not hold user full-access keys in repo or env templates.

## Wallet integration roadmap

When implementing Wallet Selector:

- Follow `.agents/skills/near-dapp/` + `.cursor/skills/near-wallet-auth/`
- Keep receipt-key flow for anonymous checkout; add wallet path for merchants
- Use testnet (`*.testnet`) until go-live checklist complete

## Agent rules

- Never prompt users to paste seed phrases into chat or MCP
- Prefer read-only RPC + view calls for debugging account state
- For writes, explicit user approval and network confirmation

## Related files

- `packages/chain/src/receipt-key.ts`
- `contracts/receipts` — signature verification
- `apps/web` checkout API routes
