# Receipt contract — binding interface (revised spec)

This is the agreed interface between the contract and the TypeScript backend. It follows
the revised `SPEC.md` (§4, §8, §9b, §9c). If the code has to differ, change this file in the
same commit and say so.

Conventions: money = `U128` strings, USDC minor units (6 dp). Times = `U64` strings, ns.
Receipt ids = JSON numbers (`u64`). Hashes, keys and signatures = lowercase hex strings.

## Receipt-key signatures (replaces raw secrets)

The customer's browser makes an ed25519 keypair. The contract stores only the public key
(`receipt_key`, 64 hex). Actions on an **unclaimed** receipt carry `sig` (128 hex):

```
preimage = utf8("uc:v1|{contract_id}|{receipt_id}|{action}|{params}|{nonce}")
sig      = ed25519_sign(receipt_private_key, sha256(preimage))      // signs the 32-byte digest
```

`nonce` is the receipt's current `nonce` (decimal). Every accepted signed action does `nonce += 1`.
`params` per action (fields joined with `|`; none of them may contain `|`):

| action | params |
|---|---|
| `request_refund` | `{amount}|{reason_hash}` |
| `cancel` | `{reason_hash}` |
| `appeal` | *(empty)* |
| `confirm_received` | *(empty)* |
| `claim` | `{account}` |
| `set_refund_target` | `{chain}|{asset}|{address}` |

Verify with `env::ed25519_verify`. Anyone may relay a signed call (the backend does). For a
**claimed** receipt the caller must be the NFT owner and `sig` is ignored/absent. `claim` always needs `sig`.

## Types (JSON)

```
Kind          = "OneTime" | "Subscription" | "Schedule"
Status        = "Held" | "PartiallyReleased" | "Released" | "PartiallyRefunded" | "Refunded"
                 derived: refunded == amount → Refunded; refunded > 0 → PartiallyRefunded;
                          released == amount → Released; released > 0 → PartiallyReleased; else Held
TrancheState  = "Pending" | "Released" | "RefundPending" | "Refunded"
RequestState  = "Open" | "AiApproved" | "AiDenied" | "Escalated" | "Approved" | "Rejected" | "Executed"
                 active (blocks release, blocks a new request) = Open | AiApproved | Escalated | Approved
RefundTarget  = { chain: string, asset: string, address: string }

MintArgs = {
  merchant_id: AccountId,
  order_ref: string,            // ≤ 64 chars; the backend sends sha256 hex. UNIQUE across the contract.
  amount: U128,                 // mint_receipt only; in ft_on_transfer the transferred amount is used
  kind: Kind,
  window_secs?: u64,            // OneTime; default merchant.default_window_secs; 0 allowed
  schedule?: [{ at: U64, amount: U128 }],   // required for Subscription/Schedule, must sum to amount
  refund_target?: RefundTarget, // ft_on_transfer default: { chain:"near", asset:<usdc account>, address:<sender> }
  receipt_key?: string,         // 64 hex ed25519 public key
  transferable?: bool           // default: kind != OneTime
}

ReceiptView = {
  id: number, token_id: string, owner_id: AccountId, claimed: bool, transferable: bool,
  merchant_id: AccountId, order_ref: string,
  amount: U128, released: U128, refunded: U128, in_flight: U128,
  kind: Kind, status: Status, window_end: U64, created_at: U64, confirmed: bool,
  schedule: [{ at: U64, amount: U128, state: TrancheState }],
  refund_target: RefundTarget,
  receipt_key: string | null, nonce: number,
  request: null | {
    amount: U128, reason_hash: string, summary_hash: string | null,
    opened_at: U64, decision_deadline: U64, veto_until: U64 | null,
    appealed: bool, is_cancel: bool, by_merchant: bool, state: RequestState
  }
}

MerchantView = {
  payout, approver, guard_threshold: U128, default_window_secs: u64, response_secs: u64,
  daily_refund_cap: U128, ai_triage: bool, auto_approve_max: U128, veto_secs: u64,
  storage_balance: U128 (yoctoNEAR), refunded_today: U128, receipt_count: u64
}

ConfigView = { usdc, executor, owner, allocated: U128, in_flight_total: U128,
               mint_lock: bool, paused: bool, receipt_count: u64, receipt_storage_cost: U128 }
```

## Methods

| Method | Caller | Behaviour |
|---|---|---|
| `new(usdc, executor, owner)` | deploy | init |
| `register_merchant(payout, approver, guard_threshold, default_window_secs, response_secs, daily_refund_cap, ai_triage, auto_approve_max, veto_secs)` **payable** | the merchant (predecessor = merchant id) | Create or update. Attached NEAR is added to `storage_balance`. |
| `fund_storage(merchant_id)` **payable** | anyone | Adds to the merchant's `storage_balance`. |
| `mint_receipt(args: MintArgs)` | executor | Primary path. Panics if paused, `mint_lock` held, merchant unknown, `order_ref` used, or `storage_balance < receipt_storage_cost`. Takes `mint_lock`, calls `usdc.ft_balance_of(self)`; the callback re-checks with **current** state: `balance ≥ allocated + in_flight_total + amount`, then stores the receipt, `allocated += amount`, charges storage, mints the NFT to the contract account; **always** clears `mint_lock`. Returns the id. |
| `ft_on_transfer(sender_id, amount, msg)` | the USDC contract only | `msg` = JSON `MintArgs` without `amount`, or `{ "topup_of": id, "at"?: U64 }`. Mint: same checks, synchronous, returns `"0"`. Top-up (Subscription/Schedule only): appends a `Pending` tranche (`at` default = max(now, last tranche `at`)), `amount`/`allocated` grow, returns `"0"`. On any failed check (bad msg, paused, unknown merchant, duplicate order_ref, no storage balance) **return the full amount** so the token contract refunds the sender — do not panic. Emits `payment_rejected` with a reason. |
| `release(id)` | anyone | Panics if paused, `in_flight > 0`, or a request is active. OneTime: needs `now ≥ window_end` or `confirmed`; pays `amount − released − refunded`. Schedules: every `Pending` tranche with `at ≤ now`. Optimistic update + `in_flight`, `ft_transfer` (1 yocto) to payout, callback rolls back on failure. |
| `request_refund(id, amount, reason_hash, sig?)` | NFT owner, or relayed sig | OneTime only. Needs `now < window_end`, not `confirmed`, no existing request unless its state is `Executed`, `0 < amount ≤ amount − released − refunded`, `in_flight == 0`. Creates `Open` with `decision_deadline = now + response_secs`. |
| `cancel(id, reason_hash, sig?)` | NFT owner, or relayed sig | Subscription/Schedule only. Every `Pending` tranche with `at > now` → `RefundPending`; their sum is the request amount (`is_cancel = true`); panics if the sum is 0. Same request rules. |
| `ai_decide(id, decision, amount, summary_hash)` | executor | Needs `merchant.ai_triage` and request `Open`. `decision` ∈ `"approve" | "partial" | "escalate" | "deny"`. approve/partial: `amount ≤ request.amount` (cancel requests: must equal); if `amount > auto_approve_max` or `amount > guard_threshold` the contract **escalates instead**; else `AiApproved`, `request.amount = amount`, `veto_until = now + veto_secs`. escalate → `Escalated`, `decision_deadline = now + response_secs`. deny → `AiDenied` (releases `RefundPending` tranches back to `Pending`). Stores `summary_hash`. |
| `veto(id, note)` | merchant approver | `AiApproved` and `now < veto_until` → `Escalated`, fresh `decision_deadline`. |
| `appeal(id, sig?)` | holder | `AiDenied` and not `appealed` → `Escalated`, `appealed = true`, fresh deadline (cancel: tranches back to `RefundPending`). Not allowed once funds were released. |
| `approve_refund(id)` | merchant approver | `Open` or `Escalated` → `Approved`. |
| `reject_refund(id, note)` | merchant approver | `Open` or `Escalated` → `Rejected` (final; `RefundPending` tranches back to `Pending`). |
| `finalize_request(id)` | anyone | `AiApproved` and `now ≥ veto_until` → `Approved`. `Open`/`Escalated` and `now ≥ decision_deadline` → `Approved` (silence = approval). Otherwise panics. |
| `merchant_refund(id, amount)` | merchant approver | No active request, `in_flight == 0`, `0 < amount ≤ unreleased` → request `Approved` (`by_merchant = true`). For schedules the amount must equal the sum of all `Pending` tranches (they become `RefundPending`). |
| `confirm_received(id, sig?)` | holder | OneTime, no active request → `confirmed = true` (releasable at once). |
| `execute_refund(id, deposit_account, amount, quote_id)` | executor | Request `Approved`, `amount == request.amount`, `in_flight == 0`, `merchant.refunded_today + amount ≤ daily_refund_cap` (UTC day buckets). **Works while paused.** Optimistic update (`refunded`, tranches → `Refunded`, `allocated`, state `Executed`), `in_flight`, `ft_transfer` to `deposit_account`, rollback callback restores everything to `Approved`. The backend registers `deposit_account` with the USDC contract first. |
| `claim(id, account, sig)` | anyone relaying a sig that binds `account` | NFT moves from the contract to `account`; `receipt_key = null`. Allowed for non-transferable receipts too. |
| `set_refund_target(id, target, sig?)` | NFT owner, or relayed sig | Not while a request is `Approved` or `in_flight > 0`. |
| `nft_transfer` / `nft_transfer_call` | NFT owner (standard) | Panics unless `transferable`. |
| `pause()` / `unpause()` | owner | Paused blocks `mint_receipt`, `ft_on_transfer` mints (amount returned) and `release`. Refund requests, decisions and `execute_refund` keep working. |
| `set_executor(executor)` | owner | — |

Views: `get_receipt(id) -> ReceiptView | null`, `get_receipt_by_order_ref(order_ref)`,
`receipts_for_merchant(merchant_id, from_index, limit)`, `receipts_for_owner(account_id, from_index, limit)`,
`get_merchant(id) -> MerchantView | null`, `get_config() -> ConfigView`, NEP-171/177/181 views.

## Events (NEP-297, `standard: "universal_checkout"`, `version: "1.0.0"`, `data: [ {...} ]`)

`receipt_minted`, `topped_up`, `payment_rejected`, `released`, `refund_requested`, `cancelled`,
`ai_decided`, `vetoed`, `appealed`, `refund_approved`, `refund_rejected`, `request_finalized`,
`refund_executed` (includes `quote_id`, `deposit_account`), `transfer_failed`, `confirmed`,
`claimed`, `refund_target_changed`, `paused`, `unpaused`. Each carries `receipt_id`,
`merchant_id` and the amounts relevant to it.

## Deliberate simplifications (record in README)

- Storage: a fixed `receipt_storage_cost` (0.01 NEAR) is charged per mint from the merchant's prepaid `storage_balance`.
- USDC storage registration of payout and refund deposit accounts is done by the backend before the transfer; a transfer to an unregistered account rolls back cleanly.
- `customer_reply_secs`, `min_order_usd`, refund-address rate limits and blocklists are enforced off-chain by the backend.

## As built — details and deviations (checked against the code and the sandbox tests)

Everything above is implemented as written, except for the points marked **Deviation**.
The rest of this section pins down details the tables leave open.

### Deployment prerequisites
- The receipts contract account **must be registered with the USDC contract**
  (`usdc.storage_deposit({account_id: <receipts>, registration_only: true})`) before it can
  receive USDC. Without it every `ft_transfer_call` / plain transfer to it fails in the token contract.
  (mock-usdc's `mint` faucet registers the target automatically.)
- Payout accounts and refund deposit accounts must be registered with USDC by the backend.
- A merchant needs `storage_balance >= receipt_storage_cost` (0.01 NEAR) per mint.

### Return values
| Method | Returns |
|---|---|
| `mint_receipt` | receipt id (number). If the balance check or a re-validation fails in the callback, the **transaction fails** with the reason as panic message (e.g. `insufficient unassigned USDC: …`, `order_ref already used`) and `mint_lock` is cleared. |
| `release`, `execute_refund` | `true` if the USDC transfer succeeded; `false` if it failed and was rolled back. **The transaction itself succeeds in both cases** — check the value (or look for `transfer_failed`). |
| `ft_on_transfer` | `"0"` accepted, or the full amount on rejection (so `ft_transfer_call` returns the used amount: the full amount when accepted, `"0"` when rejected). |
| everything else | nothing |

### Gas and deposits
| Call | Gas to attach | Deposit |
|---|---|---|
| `mint_receipt` | 100 Tgas (minimum ≈ 50) | 0 |
| `usdc.ft_transfer_call` → `ft_on_transfer` | 100 Tgas | 1 yocto (to USDC) |
| `release`, `execute_refund` | 100 Tgas (minimum ≈ 60) | 0 (the contract pays the 1 yocto) |
| `register_merchant`, `fund_storage` | 30 Tgas | NEAR to add to `storage_balance` (may be 0 on updates) |
| `nft_transfer` | 30 Tgas | 1 yocto |
| `nft_transfer_call` | 100 Tgas | 1 yocto |
| all other change methods | 30 Tgas | 0 |

### Deviations from the tables above
1. **Deviation — `mint_receipt` needs `refund_target`.** Only `ft_on_transfer` has a default (the sender). `mint_receipt` panics with `refund_target required` if it is missing. `amount` is also required there.
2. **Deviation — `mint_receipt` balance check is slightly stricter.** Required balance is `allocated + in_flight_total + amount + (USDC that left the contract since mint_receipt was called)`. This closes the case where a transfer settles between the balance read and the callback. It can only cause a spurious "insufficient" failure (retry), never over-allocation.
3. **Addition — `reset_mint_lock()`** (owner only). Emergency reset if a mint callback ever dies (out of gas). `mint_failed(reason)`, `on_mint_balance` and `on_transfer_resolved` are private callbacks.
4. **Deviation — `ft_on_transfer` panics (instead of returning the amount) when the caller is not the configured USDC contract.** A foreign token's own `ft_resolve_transfer` then refunds its sender; nothing is recorded.
5. **Addition — top-up limits.** A top-up is also rejected (amount returned) while a refund request is active on that receipt, or when the receipt already has 60 tranches. Schedules passed to mint may have 1..=60 tranches.
6. **Detail — schedules.** `window_secs` is rejected for Subscription/Schedule (`window_secs is for OneTime receipts`); their `window_end` equals `created_at` and is not used.
7. **Detail — `cancel` emits two events:** `cancelled` and then `refund_requested` (with `is_cancel: true`). `merchant_refund` emits `refund_approved` with `by_merchant: true`.
8. **Detail — `released` and `refund_executed` are emitted from the callback, only when the transfer succeeded.** A failed transfer emits `transfer_failed` instead.
9. **Detail — `appeal` on a cancel request** re-marks every `Pending` tranche with `at > now` as `RefundPending` and sets `request.amount` to their sum (tranches released in the meantime are gone); panics with `funds were already released` if the sum is 0. OneTime: panics if `request.amount > amount − released − refunded`.
10. **Detail — `veto`** sets `veto_until` back to `null`.
11. **Detail — `daily_refund_cap` is a hard cap:** `0` means the executor can refund nothing for that merchant. A failed transfer gives the amount back to the day's allowance.
12. **Detail — NFT.** `nft_transfer`/`nft_transfer_call` also refuse the contract account as receiver. The approval extension (NEP-178) is not enabled. Storage for a new owner is paid by the contract.
13. **Detail — claimed receipts:** `sig` is ignored; the receipt key is deleted at claim and `nonce` stops moving.
14. **Detail — no new request after `Rejected` or `AiDenied`** (only after `Executed`), exactly as the table says; `merchant_refund` is still possible and replaces the closed request.

### Input limits (a violation panics)
- `order_ref`: 1..=64 characters.
- `reason_hash`, `summary_hash`: lowercase hex, 0..=64 characters (empty allowed).
- `receipt_key`: exactly 64 hex characters; `sig`: exactly 128 hex characters.
- `refund_target.chain/asset/address`: 1..=128 characters each, no `|`.
- `note`: ≤ 256 characters; `quote_id`: ≤ 128 characters.
- `ai_decide.amount` is required in every call (send `"0"` for `escalate` / `deny`).
- `from_index`, `limit` in list views: JSON numbers; `limit` default 50, max 100.

### Signature preimage examples
For contract `receipts.testnet`, receipt `7`, nonce `0`:
```
uc:v1|receipts.testnet|7|request_refund|15000000|5e88…42d8|0
uc:v1|receipts.testnet|7|cancel|5e88…42d8|0
uc:v1|receipts.testnet|7|appeal||0                (empty params → two bars)
uc:v1|receipts.testnet|7|confirm_received||0
uc:v1|receipts.testnet|7|claim|alice.testnet|0
uc:v1|receipts.testnet|7|set_refund_target|base|usdc|0x00…bb|0
```
`sig = hex(ed25519_sign(private_key, sha256(utf8(preimage))))` — the 32-byte digest is the signed message.
A failed transaction does not consume the nonce; read `nonce` from `get_receipt` before signing.

### Event payloads (`data[0]`)
All amounts are strings; `receipt_id` is a number.
```
receipt_minted        { receipt_id, merchant_id, order_ref, amount, kind, window_end, schedule, refund_target, transferable }
topped_up             { receipt_id, merchant_id, order_ref, amount, at, total_amount, sender_id }
payment_rejected      { receipt_id|null, merchant_id|null, order_ref|null, sender_id, amount, reason }
released              { receipt_id, merchant_id, order_ref, amount, payout, released_total, status }
refund_requested      { receipt_id, merchant_id, order_ref, amount, reason_hash, is_cancel, ai_triage, decision_deadline, refund_target }
cancelled             { receipt_id, merchant_id, order_ref, amount, reason_hash }
ai_decided            { receipt_id, merchant_id, order_ref, decision, state, amount, summary_hash, veto_until|null, decision_deadline }
vetoed                { receipt_id, merchant_id, order_ref, amount, note, decision_deadline }
appealed              { receipt_id, merchant_id, order_ref, amount, decision_deadline }
refund_approved       { receipt_id, merchant_id, order_ref, amount, by_merchant, refund_target }
refund_rejected       { receipt_id, merchant_id, order_ref, amount, note }
request_finalized     { receipt_id, merchant_id, order_ref, amount, from_state, state: "Approved", refund_target }
refund_executed       { receipt_id, merchant_id, order_ref, amount, deposit_account, quote_id, refund_target, refunded_total, status }
transfer_failed       { receipt_id, merchant_id, order_ref, amount, action: "release"|"refund", to, quote_id|null }
confirmed             { receipt_id, merchant_id, order_ref, amount }
claimed               { receipt_id, merchant_id, order_ref, amount, owner_id }
refund_target_changed { receipt_id, merchant_id, order_ref, refund_target }
paused / unpaused     { by }
```
`ai_decided.decision` is what the executor asked for; `state` is what the contract did
(an `approve` above `auto_approve_max` or `guard_threshold` yields `state: "Escalated"`).
The standard NEP-171 `nft_mint` / `nft_transfer` events are emitted as well.

### mock-usdc
`new()`, `mint({account_id, amount})` (anyone; registers the account), plus standard NEP-141 /
NEP-145 / NEP-148 (`ft_transfer`, `ft_transfer_call`, `ft_balance_of`, `storage_deposit`, `ft_metadata` …).
