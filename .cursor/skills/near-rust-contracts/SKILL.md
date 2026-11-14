---
name: near-rust-contracts
description: Rust smart contracts for Zap. Delegates to official near-smart-contracts skill plus contracts/ layout. Use when editing contracts/**/*.rs.
---

# near-rust-contracts

**Official playbook:** `.agents/skills/near-smart-contracts/SKILL.md` and `rules/`.

**This repo:** `contracts/receipts`, `contracts/mock-usdc`; interface in `contracts/INTERFACE.md`.

## Build & test

```bash
pnpm test:contracts
pnpm build:contracts
```

## Security

`.agents/skills/near-contract-audit/` before mainnet changes.

## Reference

`docs/near/smart-contracts.md`
