# Contracts

Two NEAR contracts in one cargo workspace:

| Crate | What it is |
|---|---|
| `receipts/` | The receipt contract. Every payment is a NEP-171 token that holds USDC until it is released to the merchant or refunded to the customer. |
| `mock-usdc/` | NEP-141 token, 6 decimals, symbol `USDC`, with an open `mint` faucet. Sandbox and testnet only; it has no value. |

**The interface (methods, JSON shapes, events, signatures, gas) is in [`INTERFACE.md`](./INTERFACE.md).**
Its last section, "As built", lists every place where the code differs from or adds to the agreed tables.

Unaudited hackathon prototype. Do not put real money in it.

## Build and test

Needs `rustup` and `cargo-near` (0.21+). The toolchain is pinned in `rust-toolchain.toml`
(Rust 1.97.1, target `wasm32-unknown-unknown`).

```bash
# from the repo root: build both contracts and refresh contracts/artifacts/*.wasm
./scripts/build-contracts.sh

# from contracts/
cargo test            # unit tests + sandbox tests (about 1.5 minutes)
cargo test --lib      # unit tests only (seconds)
cargo clippy --all-targets
```

The sandbox tests (`receipts/tests/sandbox.rs`) build both contracts with cargo-near, start a
local `near-sandbox` node per test (the binary is downloaded on first use) and drive everything
through real transactions, including `ft_transfer_call`, cross-contract callbacks and
fast-forwarded time. No real network, key or money is involved.

`artifacts/receipts.wasm` and `artifacts/mock_usdc.wasm` are committed so the demo runs without
Rust. Builds are `non-reproducible-wasm`: rebuilding on another machine can give a different hash.

## How it works

- **Money in.** Either the executor calls `mint_receipt` after USDC arrived by plain transfer
  (balance-gated, one mint at a time), or the payer sends USDC with `ft_transfer_call` and the
  receipt is minted inside `ft_on_transfer`. A rejected direct payment is returned in full.
- **Money out.** `release` (anyone, after the window / when tranches are due / after the customer
  confirmed) pays the merchant. `execute_refund` (executor) pays an `Approved` refund request.
  Both update state first, mark the amount `in_flight`, and restore everything in the callback
  if the USDC transfer fails. While `in_flight > 0` the receipt refuses release, refund and new requests.
- **Refund requests** are a state machine on the receipt (`Open → AiApproved / AiDenied / Escalated →
  Approved / Rejected → Executed`), see `receipts/src/refunds.rs`. Merchant silence past the
  deadline counts as approval; `finalize_request` can be called by anyone.
- **Customer auth without an account.** An unclaimed receipt stores an ed25519 public key. Holder
  actions carry a signature over the exact action, parameters and a per-receipt nonce, so a
  relayed signature cannot be replayed or reused for different parameters. After `claim` the
  NFT owner acts directly.
- **Invariant.** `allocated` = USDC held for receipts; `allocated + in_flight_total` never exceeds
  the contract's USDC balance as long as USDC only leaves through this contract.

## Trust assumptions

- **Executor** (settlement worker key) is trusted to (a) attribute a plain-transfer payment to the
  right order in `mint_receipt`, (b) pass a `deposit_account` in `execute_refund` that really leads
  to the receipt's `refund_target` (the `quote_id` is logged so anyone can check), and (c) relay AI
  decisions honestly in `ai_decide`. It cannot refund without an `Approved` request, cannot exceed
  the request amount, the unreleased funds or the merchant's daily cap, and cannot release to
  anyone but the merchant payout.
- **Owner** can pause mints and releases, replace the executor and reset the mint lock. It cannot
  move funds. Refunds keep working while paused.
- **Merchant approver** decides escalated requests and can refund unreleased funds at any time.
  The merchant controls its own `daily_refund_cap`; a cap of 0 blocks refunds for its receipts.
- **Receipt key.** Whoever holds the private key of an unclaimed receipt can request a refund,
  change the refund target and claim the NFT. It lives in the customer's receipt link.
- **USDC contract** is trusted to implement NEP-141 correctly.
- Refunds are in USDC value. Converting back to the customer's coin, and the swap fee, happen
  off-chain after `execute_refund`.

## Simplifications and known limits

- **Storage.** A fixed 0.01 NEAR per receipt is charged from the merchant's prepaid
  `storage_balance`. Later growth (top-up tranches, a refund request, a new NFT owner entry) is
  small and paid from the contract's own balance. `storage_balance` cannot be withdrawn.
- **USDC registration** of the receipts contract, payout accounts and refund deposit accounts is
  the backend's job. A transfer to an unregistered account fails and rolls back cleanly.
- **Mixing the two payment paths.** `mint_receipt` reads a balance that may already contain a
  direct payment whose `ft_on_transfer` has not run yet. This only matters if the executor mints
  for an order whose own USDC has not arrived, in the same couple of blocks as an unrelated
  direct payment. The executor must only mint after the delivery is confirmed.
- **Receipt-key front-running.** A signature is public once its transaction is submitted. It is
  bound to action, parameters and nonce, so the worst a relayer can do is submit it first.
- `customer_reply_secs`, minimum order size, refund-address rate limits and blocklists are
  enforced off-chain.
- No upgrade or migration path; redeploy to change the contract.
- At most 60 tranches per receipt.

## Test coverage

Unit tests (`receipts/src/tests.rs`, callbacks invoked directly) and sandbox tests
(`receipts/tests/sandbox.rs`) cover: mint gating (two mints against one deposit, transfer in
flight, transfer settled before the callback, mint lock), duplicate `order_ref`, direct payment
mint / rejection returns funds / top-up, pause (blocks both mint paths and release, not
`execute_refund`), release after the window and after `confirm_received`, release blocked while a
request is active, the whole request flow (AI approve → veto window → finalize → execute; escalate
→ approve / reject; deny → appeal once; silence = approve; veto), `merchant_refund`, cancel
pro-rata, daily cap, signature replay and parameter tampering, claim + transfer by the new owner,
non-transferable one-time receipts, rollback of failed transfers to unregistered accounts, no
double release / refund while in flight, and executor / owner / approver-only checks.

Not covered by a sandbox test (unit tests only): two `mint_receipt` transactions racing in the
same block, and a mint racing an in-flight transfer.
