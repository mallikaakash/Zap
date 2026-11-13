# Contracts

Two NEAR contracts in one cargo workspace:

| Crate | What it is |
|---|---|
| `receipts/` | The receipt contract. Every payment is a NEP-171 token that holds USDC until it is released to the merchant or refunded to the customer. |
| `mock-usdc/` | NEP-141 token, 6 decimals, symbol `USDC`, with an open `mint` faucet. Sandbox and testnet only; it has no value. |

**The interface (methods, JSON shapes, events, signatures, gas) is in [`INTERFACE.md`](./INTERFACE.md).**
Its last section, "As built", lists every place where the code differs from or adds to the agreed tables.

Unaudited prototype. On mainnet it should only ever hold small amounts: keep
`max_receipt_amount` low (see "Mainnet deployment" below).

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
- **Owner** can pause mints and releases, replace the executor, hand over ownership
  (`set_owner`), set the per-receipt storage charge and the per-payment cap, reset the mint lock,
  and withdraw USDC that **no receipt owns** (`withdraw_unassigned`: over-deliveries, stray plain
  transfers). It cannot move allocated or in-flight USDC. Refunds keep working while paused.
- **Owner and executor (operator registration).** `register_merchant_for` lets either of them
  create and update merchants that never sign anything, **including their payout account**.
  Whoever holds either key can therefore redirect future releases of operator-registered
  merchants. Merchants that registered themselves (`self_managed`) cannot be changed by them.
- **Merchant approver** decides escalated requests and can refund unreleased funds at any time.
  The merchant controls its own `daily_refund_cap`; a cap of 0 blocks refunds for its receipts.
- **Receipt key.** Whoever holds the private key of an unclaimed receipt can request a refund,
  change the refund target and claim the NFT. It lives in the customer's receipt link.
- **USDC contract** is trusted to implement NEP-141 correctly.
- Refunds are in USDC value. Converting back to the customer's coin, and the swap fee, happen
  off-chain after `execute_refund`.

## Simplifications and known limits

- **Storage.** `receipt_storage_cost` (default 0.014 NEAR, owner-settable) is charged per
  receipt from the merchant's prepaid `storage_balance`; a receipt measures 1,060–1,291 bytes
  (INTERFACE.md, "Storage"). Later growth (top-up tranches, a refund request, a new NFT owner
  entry) and merchant entries themselves are paid from the contract's own balance.
  `storage_balance` cannot be withdrawn.
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
- No upgrade or migration path; redeploy to change the contract. The state layout changed with
  `register_merchant_for` / `max_receipt_amount`, so a contract deployed from an older build
  cannot be upgraded in place: deploy to a fresh account.
- `withdraw_unassigned` cannot tell a direct payment whose `ft_on_transfer` has not run yet
  (its first block or two) from surplus. Only withdraw an amount you have already seen as
  surplus.
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
Also: operator registration (owner/executor only, no takeover of self-registered merchants,
mint and release to the operator-set payout), the storage charge (default and owner-set value
actually charged, storage measured per receipt), `max_receipt_amount` on `mint_receipt`, direct
payments and top-ups, `withdraw_unassigned` (owner only, refuses allocated and in-flight USDC,
works for real surplus, rolls back when `to` is not registered with USDC), and `set_owner`.

Not covered by a sandbox test (unit tests only): two `mint_receipt` transactions racing in the
same block, a mint racing an in-flight transfer, a withdrawal racing a release or a rejected
direct payment, and a withdrawal while a release is in flight.

## Mainnet deployment

The human runs these; nothing here is automated. Mainnet USDC (native, 6 decimals) is
`17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`. Examples use near-cli-rs
with the accounts from DECISIONS.md (`checkout.aakash7777.near` = contract, `aakash7777.near` =
operator/owner; `executor.aakash7777.near` stands for whatever the executor subaccount is
called). Check the exact flags against `near --help` for your near-cli-rs version.

1. **Accounts and NEAR.** The contract account pays for its code (about 3.8 NEAR for the
   380 KB wasm at 1e19 yoctoNEAR/byte) plus state that merchants do not prepay (merchant
   entries ≈ 0.003 NEAR each, refund requests, claims, top-up tranches). Fund it with at least
   5 NEAR before deploying.
2. **Deploy and init.** `new` takes the USDC contract, the executor and the owner:
   ```bash
   near contract deploy checkout.aakash7777.near use-file contracts/artifacts/receipts.wasm \
     with-init-call new json-args '{"usdc":"17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1","executor":"executor.aakash7777.near","owner":"aakash7777.near"}' \
     prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-keychain send
   ```
3. **Register the contract with USDC** (otherwise every payment to it fails in the token
   contract). Check `storage_balance_bounds` on the USDC contract first; the minimum is usually
   0.00125 NEAR:
   ```bash
   near contract call-function as-transaction 17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1 storage_deposit \
     json-args '{"account_id":"checkout.aakash7777.near","registration_only":true}' \
     prepaid-gas '30.0 Tgas' attached-deposit '0.00125 NEAR' sign-as aakash7777.near network-config mainnet sign-with-keychain send
   ```
   Every merchant payout account and every refund deposit account must be registered the same
   way before money is sent to it (the backend does this; a transfer to an unregistered account
   rolls back).
4. **Fund storage.** Each receipt costs the merchant `receipt_storage_cost` (0.014 NEAR). The
   operator pays it: attach NEAR to `register_merchant_for`, or call
   `fund_storage({"merchant_id": …})` with a deposit, e.g. 0.14 NEAR for 10 receipts. A merchant
   whose `storage_balance` is below the cost cannot receive payments (direct payments are
   returned with `merchant storage balance too low`). Watch `get_merchant(id).storage_balance`.
   Adjust the charge with `set_receipt_storage_cost({"amount": "<yoctoNEAR>"})` if needed.
5. **Set the cap.** The default `max_receipt_amount` is 1,000 USDC. For an unaudited contract,
   lower it to the largest order you expect, e.g. 5 USDC for the demo:
   `set_max_receipt_amount({"amount": "5000000"})` (owner).
6. **Ownership.** The owner can pause, swap the executor, change the cap and storage charge,
   register merchants and withdraw surplus USDC, so keep its key off the server: use the
   operator account (`aakash7777.near`) or a hardware-wallet account, never the executor or
   relayer. The executor key (settlement worker) and the relayer key live on the server. If you
   deployed with a different owner, move it with `set_owner({"owner": …})` from the current owner
   (one step, no acceptance: double-check the id). After deploying, consider removing the full
   access key of `checkout.aakash7777.near` (it makes the code immutable; there is no upgrade
   path anyway).
7. **Check.** `get_config` should show the right `usdc`, `executor`, `owner`,
   `max_receipt_amount`, `receipt_storage_cost`, and `paused: false`.
8. **Recovering stray USDC.** If 1Click delivers more than ordered, or someone sends USDC with a
   plain transfer, the surplus is `ft_balance_of(contract) − allocated − in_flight_total`. The
   owner can send it out with `withdraw_unassigned({"to": …, "amount": …})` (100 Tgas; `to` must
   be registered with USDC). It refuses anything that belongs to receipts.
