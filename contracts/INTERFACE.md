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
