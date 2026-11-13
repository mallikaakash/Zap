# Smart contracts (Rust / near-sdk)

**Repo crates:** `contracts/receipts`, `contracts/mock-usdc`  
**SDK:** `near-sdk` / `near-contract-standards` **5.29.1**  
**Deep reference:** `.agents/skills/near-smart-contracts/`

## NEAR fundamentals (contract-relevant)

### Accounts

- Human-readable IDs (`name.near`, `sub.name.testnet`) and **implicit** accounts (64-char hex from public key).
- **Access keys:** full-access vs function-call (method allowlist + optional allowance).

### Transactions and execution

- **Actions:** `CreateAccount`, `AddKey`, `FunctionCall`, `Transfer`, `DeleteKey`, `DeleteAccount`, …
- **Receipts:** async cross-contract calls complete via callback receipts; always handle failure in `#[private]` callbacks.
- **Finality:** wait for appropriate finality before assuming state (see NEAR docs on finality).

### Gas and storage

- Gas prepaid on function calls; attach extra for cross-contract promises.
- **Storage staking:** contract pays for persistent state; measure additions (tests include storage cost checks).

## Patterns in `receipts`

| Concern | Implementation hint |
| ------- | ------------------- |
| NFT | `near-contract-standards` NEP-171 patterns in `nft.rs` |
| Escrow | USDC balance vs per-receipt allocation |
| Refunds | State machine in `refunds.rs`; 1Click off-chain |
| Auth | Receipt-key signatures verified on-chain |
| Events | `events.rs` for indexers |
| Pause / caps | Owner controls; documented in `INTERFACE.md` |

## Development workflow

```bash
cd contracts
cargo test --locked          # unit + sandbox (near-sandbox)
cargo near build non-reproducible-wasm   # per crate README
```

Sandbox tests live in `contracts/receipts/tests/sandbox.rs` — **13 tests** verified 2026-11-13.

## Cross-contract calls (XCC)

When adding external calls:

1. Attach sufficient gas for callee + callback.
2. Use `#[private]` on callbacks; no user-triggered callback entrypoints.
3. Assume callee failure — escrow must stay consistent.

See `.agents/skills/near-smart-contracts/rules/` (promises, security-storage-checks).

## Upgrades

Contract is **unaudited prototype**. Before migrations:

- Read upgrade rules in smart-contracts skill
- Plan state migration methods; never break serialized layout silently

## Testing requirements

- Unit tests in `src/tests.rs`
- Integration tests must pass before deploy
- Do not deploy uncommitted WASM to mainnet without audit skill pass

## Security checks (minimum)

- `assert` owner/merchant/receipt-key auth on every mutating method
- Validate attached deposit for NEP-141 flows
- Reentrancy-aware state updates (update state before external calls where applicable)
- Daily caps and pause flags enforced on-chain, not only in UI

See [security.md](./security.md) and `.agents/skills/near-contract-audit/`.
