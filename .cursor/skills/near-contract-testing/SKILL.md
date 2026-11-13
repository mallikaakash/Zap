---
name: near-contract-testing
description: Contract testing for this repo — near-sandbox integration tests, cargo test, prebuilt WASM for demo. Use before deploy or contract refactors.
---

# near-contract-testing

## Commands

```bash
cd contracts && cargo test --locked
pnpm test:contracts
```

## Layout

- Unit: `contracts/receipts/src/tests.rs`
- Sandbox: `contracts/receipts/tests/sandbox.rs` (13 scenarios)

## Tooling

- `near-sandbox` 0.3, `near-api` dev-dep, Rust 1.97.1

## Agents

Run tests after any `contracts/**` edit; report real output.

## Reference

`docs/near/testing.md`
