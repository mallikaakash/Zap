//! Unit tests. Cross-contract calls are simulated by invoking the callbacks directly with the
//! result the USDC contract would have produced. Real promise flows are covered by the sandbox
//! tests in `tests/sandbox.rs`.

use ed25519_dalek::{Signer, SigningKey};
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;
use near_sdk::json_types::U128;
use near_sdk::serde_json::{json, Value};
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{env, testing_env, AccountId, NearToken, PromiseError, PromiseOrValue};

use crate::*;

const SEC: u64 = 1_000_000_000;
const DAY: u64 = 86_400 * SEC;
/// Midnight UTC of some day, so day-bucket tests are easy to reason about.
const T0: u64 = 19_700 * DAY;
const USDC: u128 = 1_000_000;

const WINDOW: u64 = 60;
const RESPONSE: u64 = 100;
const VETO: u64 = 30;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx_deposit(predecessor: &str, now: u64, deposit: NearToken) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("receipts.near"))
        .predecessor_account_id(acc(predecessor))
        .block_timestamp(now)
        .attached_deposit(deposit)
        .build());
}

fn ctx(predecessor: &str, now: u64) {
    ctx_deposit(predecessor, now, NearToken::from_yoctonear(0));
}

fn signing_key() -> SigningKey {
    SigningKey::from_bytes(&[9u8; 32])
}

fn receipt_key() -> String {
    to_hex(signing_key().verifying_key().as_bytes())
}

/// Receipt-key signature exactly as documented in INTERFACE.md.
fn sign(id: u64, action: &str, params: &str, nonce: u32) -> Option<String> {
    let preimage = format!("uc:v1|receipts.near|{id}|{action}|{params}|{nonce}");
    let digest = env::sha256_array(preimage.as_bytes());
    Some(to_hex(&signing_key().sign(&digest).to_bytes()))
}

const REASON: &str = "aa11";

/// Contract with merchant `shop.near`: guard 50 USDC, window 60 s, response 100 s, daily cap
/// 200 USDC, AI triage on with auto-approve up to 20 USDC and a 30 s veto window.
fn setup() -> Contract {
    ctx("owner.near", T0);
    let mut c = Contract::new(acc("usdc.near"), acc("executor.near"), acc("owner.near"));
    register(&mut c, "shop.near", true);
    c
}

fn register(c: &mut Contract, merchant: &str, ai_triage: bool) {
    ctx_deposit(merchant, T0, NearToken::from_near(1));
    c.register_merchant(
        acc("payout.near"),
        acc("approver.near"),
        U128(50 * USDC),
        WINDOW,
        RESPONSE,
        U128(200 * USDC),
        ai_triage,
        U128(20 * USDC),
        VETO,
    );
}

fn one_time(order_ref: &str) -> Value {
    json!({
        "merchant_id": "shop.near",
        "order_ref": order_ref,
        "kind": "OneTime",
        "refund_target": {"chain": "polygon", "asset": "usdt", "address": "0xabc"},
        "receipt_key": receipt_key(),
    })
}

fn schedule(order_ref: &str, tranches: &[(u64, u128)]) -> Value {
    let mut v = one_time(order_ref);
    v["kind"] = json!("Schedule");
    v["schedule"] = tranches
        .iter()
        .map(|(at, amount)| json!({"at": at.to_string(), "amount": amount.to_string()}))
        .collect();
    v
}

/// Direct USDC payment: `ft_on_transfer` as called by the USDC contract. Returns the amount
/// handed back to the sender (0 = accepted).
fn pay(c: &mut Contract, msg: Value, amount: u128, now: u64) -> u128 {
    ctx("usdc.near", now);
    match c.ft_on_transfer(acc("payer.near"), U128(amount), msg.to_string()) {
        PromiseOrValue::Value(v) => v.0,
        PromiseOrValue::Promise(_) => panic!("unexpected promise"),
    }
}

/// Pays and returns the new receipt id.
fn paid(c: &mut Contract, msg: Value, amount: u128, now: u64) -> u64 {
    assert_eq!(pay(c, msg, amount, now), 0, "payment rejected: {:?}", get_logs());
    c.get_config().receipt_count
}

/// `mint_receipt` plus its callback, as if `ft_balance_of` returned `balance`.
/// Returns the receipt id, or None if the mint was refused.
fn mint(c: &mut Contract, mut args: Value, amount: u128, balance: u128, now: u64) -> Option<u64> {
    args["amount"] = json!(amount.to_string());
    let args: MintArgs = near_sdk::serde_json::from_value(args).unwrap();
    ctx("executor.near", now);
    let _ = c.mint_receipt(args.clone());
    assert!(c.get_config().mint_lock);
    let settled = U128(c.settled_total);
    ctx("receipts.near", now);
    let out = c.on_mint_balance(args, settled, Ok(U128(balance)));
    assert!(!c.get_config().mint_lock);
    match out {
        PromiseOrValue::Value(id) => Some(id),
        PromiseOrValue::Promise(_) => None,
    }
}

fn states(c: &Contract, id: u64) -> Vec<TrancheState> {
    c.get_receipt(id).unwrap().schedule.iter().map(|t| t.state).collect()
}

/// Resolves the transfer started by `release`/`execute_refund`, as the real callback would.
fn resolve(
    c: &mut Contract,
    id: u64,
    kind: TransferKind,
    before: Vec<TrancheState>,
    to: &str,
    now: u64,
    ok: bool,
) -> bool {
    let r = c.get_receipt(id).unwrap();
    let amount = r.in_flight;
    assert!(amount.0 > 0);
    assert_eq!(c.get_config().in_flight_total, amount);
    let tranches = r
        .schedule
        .iter()
        .zip(before)
        .enumerate()
        .filter(|(_, (t, b))| t.state != *b)
        .map(|(i, _)| i as u32)
        .collect();
    ctx("receipts.near", now);
    let res = if ok { Ok(()) } else { Err(PromiseError::Failed) };
    let quote = (kind == TransferKind::Refund).then(|| "quote-1".to_string());
    c.on_transfer_resolved(id, kind, amount, tranches, acc(to), quote, res)
}

fn release(c: &mut Contract, id: u64, now: u64, ok: bool) -> bool {
    let before = states(c, id);
    ctx("anyone.near", now);
    let _ = c.release(id);
    resolve(c, id, TransferKind::Release, before, "payout.near", now, ok)
}

fn execute(c: &mut Contract, id: u64, amount: u128, now: u64, ok: bool) -> bool {
    let before = states(c, id);
    ctx("executor.near", now);
    let _ = c.execute_refund(id, acc("sink.near"), U128(amount), "quote-1".into());
    resolve(c, id, TransferKind::Refund, before, "sink.near", now, ok)
}

/// Signed `request_refund` relayed by a third party.
fn request(c: &mut Contract, id: u64, amount: u128, now: u64) {
    let nonce = c.get_receipt(id).unwrap().nonce;
    ctx("relayer.near", now);
    c.request_refund(
        id,
        U128(amount),
        REASON.into(),
        sign(id, "request_refund", &format!("{amount}|{REASON}"), nonce),
    );
}

fn cancel(c: &mut Contract, id: u64, now: u64) {
    let nonce = c.get_receipt(id).unwrap().nonce;
    ctx("relayer.near", now);
    c.cancel(id, REASON.into(), sign(id, "cancel", REASON, nonce));
}

fn decide(c: &mut Contract, id: u64, decision: &str, amount: u128, now: u64) {
    ctx("executor.near", now);
    c.ai_decide(id, decision.into(), U128(amount), "bb22".into());
}

fn req_state(c: &Contract, id: u64) -> RequestState {
    c.get_receipt(id).unwrap().request.unwrap().state
}

fn has_event(name: &str) -> bool {
    get_logs()
        .iter()
        .any(|l| l.starts_with("EVENT_JSON:") && l.contains(&format!("\"event\":\"{name}\"")))
}

// ----------------------------------------------------------------------- hex

#[test]
fn hex_roundtrip() {
    let bytes = [0xabu8; 32];
    assert_eq!(from_hex::<32>(&to_hex(&bytes)), Some(bytes));
    assert_eq!(from_hex::<32>("abcd"), None);
    assert_eq!(from_hex::<32>(&"zz".repeat(32)), None);
}

// -------------------------------------------------------------- mint_receipt

#[test]
fn mint_receipt_stores_receipt_and_charges_storage() {
    let mut c = setup();
    let id = mint(&mut c, one_time("order-1"), 10 * USDC, 10 * USDC, T0).unwrap();
    assert!(has_event("receipt_minted"));
    assert_eq!(id, 1);
    let r = c.get_receipt(1).unwrap();
    assert_eq!(r.amount.0, 10 * USDC);
    assert_eq!(r.status, Status::Held);
    assert_eq!(r.window_end.0, T0 + WINDOW * SEC);
    assert_eq!(r.owner_id, acc("receipts.near"));
    assert!(!r.claimed && !r.transferable && !r.confirmed);
    assert_eq!((r.nonce, r.receipt_key), (0, Some(receipt_key())));
    assert!(r.request.is_none());
    let cfg = c.get_config();
    assert_eq!((cfg.allocated.0, cfg.receipt_count), (10 * USDC, 1));
    assert_eq!(cfg.receipt_storage_cost.0, RECEIPT_STORAGE_COST);
    let m = c.get_merchant(acc("shop.near")).unwrap();
    assert_eq!(m.receipt_count, 1);
    assert_eq!(
        m.storage_balance.0,
        NearToken::from_near(1).as_yoctonear() - RECEIPT_STORAGE_COST
    );
    assert_eq!(
        c.nft_token("1".into()).unwrap().metadata.unwrap().title.unwrap(),
        "Receipt #1"
    );
    assert_eq!(c.receipts_for_merchant(acc("shop.near"), None, None).len(), 1);
    assert_eq!(c.receipts_for_owner(acc("receipts.near"), None, None).len(), 1);
    assert_eq!(c.get_receipt_by_order_ref("order-1".into()).unwrap().id, 1);
}

#[test]
fn mint_receipt_never_over_allocates() {
    let mut c = setup();
    // nothing delivered
    assert_eq!(mint(&mut c, one_time("o1"), 10 * USDC, 10 * USDC - 1, T0), None);
    assert_eq!(c.get_config().receipt_count, 0);
    assert_eq!(c.get_config().allocated.0, 0);
    // delivered: first mint succeeds, a second one against the same deposit does not
    assert_eq!(mint(&mut c, one_time("o1"), 10 * USDC, 10 * USDC, T0), Some(1));
    assert_eq!(mint(&mut c, one_time("o2"), 10 * USDC, 10 * USDC, T0), None);
    assert_eq!(mint(&mut c, one_time("o2"), 1, 10 * USDC, T0), None);
    assert_eq!(c.get_config().allocated.0, 10 * USDC);

    // a transfer in flight: the token contract may still report the leaving 10 USDC
    ctx("anyone.near", T0 + WINDOW * SEC);
    let _ = c.release(1);
    assert_eq!(c.get_config().in_flight_total.0, 10 * USDC);
    assert_eq!(c.get_config().allocated.0, 0);
    let now = T0 + WINDOW * SEC;
    assert_eq!(mint(&mut c, one_time("o2"), 10 * USDC, 20 * USDC - 1, now), None);
    assert_eq!(mint(&mut c, one_time("o2"), 10 * USDC, 20 * USDC, now), Some(2));
}

#[test]
fn stale_balance_cannot_be_reassigned_after_transfer_settled() {
    let mut c = setup();
    mint(&mut c, one_time("o1"), 10 * USDC, 10 * USDC, T0).unwrap();
    let now = T0 + WINDOW * SEC;
    // Mint starts and reads a balance of 10 while the first receipt is still held.
    let mut args = one_time("o2");
    args["amount"] = json!((10 * USDC).to_string());
    let args: MintArgs = near_sdk::serde_json::from_value(args).unwrap();
    ctx("executor.near", now);
    let _ = c.mint_receipt(args.clone());
    let settled_at_init = U128(c.settled_total);
    // The release settles before the mint callback runs.
    assert!(release(&mut c, 1, now, true));
    assert_eq!(c.get_config().allocated.0, 0);
    ctx("receipts.near", now);
    let out = c.on_mint_balance(args, settled_at_init, Ok(U128(10 * USDC)));
    assert!(matches!(out, PromiseOrValue::Promise(_)));
    assert_eq!(c.get_config().receipt_count, 1);
    assert!(!c.get_config().mint_lock);
}

#[test]
fn mint_lock_is_cleared_when_balance_call_fails() {
    let mut c = setup();
    let mut args = one_time("o1");
    args["amount"] = json!("5");
    let args: MintArgs = near_sdk::serde_json::from_value(args).unwrap();
    ctx("executor.near", T0);
    let _ = c.mint_receipt(args.clone());
    ctx("receipts.near", T0);
    let out = c.on_mint_balance(args, U128(0), Err(PromiseError::Failed));
    assert!(matches!(out, PromiseOrValue::Promise(_)));
    assert!(!c.get_config().mint_lock);
}

#[test]
#[should_panic(expected = "another mint is in flight")]
fn only_one_mint_in_flight() {
    let mut c = setup();
    let mut args = one_time("o1");
    args["amount"] = json!("5");
    let args: MintArgs = near_sdk::serde_json::from_value(args).unwrap();
    ctx("executor.near", T0);
    let _ = c.mint_receipt(args.clone());
    let _ = c.mint_receipt(args);
}

#[test]
#[should_panic(expected = "executor only")]
fn mint_is_executor_only() {
    let mut c = setup();
    let mut args = one_time("o1");
    args["amount"] = json!("5");
    ctx("shop.near", T0);
    let _ = c.mint_receipt(near_sdk::serde_json::from_value(args).unwrap());
}

#[test]
#[should_panic(expected = "order_ref already used")]
fn order_ref_is_unique_across_merchants() {
    let mut c = setup();
    register(&mut c, "other.near", false);
    paid(&mut c, one_time("o1"), USDC, T0);
    let mut args = one_time("o1");
    args["merchant_id"] = json!("other.near");
    args["amount"] = json!("5");
    ctx("executor.near", T0);
    let _ = c.mint_receipt(near_sdk::serde_json::from_value(args).unwrap());
}

#[test]
#[should_panic(expected = "merchant storage balance too low")]
fn mint_needs_prepaid_storage() {
    let mut c = setup();
    ctx("poor.near", T0);
    c.register_merchant(
        acc("payout.near"),
        acc("approver.near"),
        U128(0),
        0,
        0,
        U128(0),
        false,
        U128(0),
        0,
    );
    let mut args = one_time("o1");
    args["merchant_id"] = json!("poor.near");
    args["amount"] = json!("5");
    ctx("executor.near", T0);
    let _ = c.mint_receipt(near_sdk::serde_json::from_value(args).unwrap());
}

#[test]
fn fund_storage_tops_up_any_merchant() {
    let mut c = setup();
    ctx_deposit("friend.near", T0, NearToken::from_near(2));
    c.fund_storage(acc("shop.near"));
    assert_eq!(
        c.get_merchant(acc("shop.near")).unwrap().storage_balance.0,
        NearToken::from_near(3).as_yoctonear()
    );
}

// ------------------------------------------------------------ ft_on_transfer

#[test]
fn direct_payment_mints_with_default_refund_target() {
    let mut c = setup();
    let mut msg = one_time("o1");
    msg.as_object_mut().unwrap().remove("refund_target");
    msg["window_secs"] = json!(0);
    assert_eq!(pay(&mut c, msg, 7 * USDC, T0), 0);
    let r = c.get_receipt(1).unwrap();
    assert_eq!(r.amount.0, 7 * USDC);
    assert_eq!(r.window_end.0, T0);
    assert_eq!(
        r.refund_target,
        RefundTarget {
            chain: "near".into(),
            asset: "usdc.near".into(),
            address: "payer.near".into()
        }
    );
    assert_eq!(c.get_config().allocated.0, 7 * USDC);
}

#[test]
fn rejected_direct_payment_returns_the_full_amount() {
    let mut c = setup();
    let check = |c: &mut Contract, msg: String, reason: &str| {
        ctx("usdc.near", T0);
        let before = c.get_config();
        let out = c.ft_on_transfer(acc("payer.near"), U128(5 * USDC), msg);
        assert!(matches!(out, PromiseOrValue::Value(U128(v)) if v == 5 * USDC));
        assert!(has_event("payment_rejected"));
        assert!(
            get_logs().iter().any(|l| l.contains(reason)),
            "expected reason {reason:?} in {:?}",
            get_logs()
        );
        let after = c.get_config();
        assert_eq!(after.allocated, before.allocated);
        assert_eq!(after.receipt_count, before.receipt_count);
    };
    check(&mut c, "not json".into(), "msg is not valid JSON");
    check(&mut c, "{}".into(), "bad mint msg");
    let mut unknown = one_time("o1");
    unknown["merchant_id"] = json!("nobody.near");
    check(&mut c, unknown.to_string(), "merchant not registered");
    let mut bad_key = one_time("o1");
    bad_key["receipt_key"] = json!("1234");
    check(&mut c, bad_key.to_string(), "receipt_key must be 64 hex characters");
    let wrong_sum = schedule("o1", &[(T0, USDC)]);
    check(&mut c, wrong_sum.to_string(), "schedule must sum to amount");
    check(&mut c, json!({"topup_of": 99}).to_string(), "receipt not found");

    paid(&mut c, one_time("o1"), USDC, T0);
    check(&mut c, one_time("o1").to_string(), "order_ref already used");
    check(
        &mut c,
        json!({"topup_of": 1}).to_string(),
        "top-up is for Subscription/Schedule receipts",
    );

    ctx("owner.near", T0);
    c.pause();
    check(&mut c, one_time("o2").to_string(), "contract is paused");
}

#[test]
#[should_panic(expected = "only the USDC contract may call ft_on_transfer")]
fn other_tokens_are_refused() {
    let mut c = setup();
    ctx("scam-token.near", T0);
    let _ = c.ft_on_transfer(acc("payer.near"), U128(5), one_time("o1").to_string());
}

#[test]
fn top_up_appends_a_tranche() {
    let mut c = setup();
    let id = paid(
        &mut c,
        schedule("pass-1", &[(T0, 10 * USDC), (T0 + 100 * SEC, 10 * USDC)]),
        20 * USDC,
        T0,
    );
    assert!(c.get_receipt(id).unwrap().transferable);
    assert!(release(&mut c, id, T0 + 100 * SEC, true));
    assert_eq!(c.get_receipt(id).unwrap().status, Status::Released);

    // default `at` = max(now, last tranche at)
    assert_eq!(pay(&mut c, json!({"topup_of": id}), 10 * USDC, T0 + 50 * SEC), 0);
    assert!(has_event("topped_up"));
    assert_eq!(pay(&mut c, json!({"topup_of": id}), 5 * USDC, T0 + 150 * SEC), 0);
    let at = (T0 + 300 * SEC).to_string();
    assert_eq!(pay(&mut c, json!({"topup_of": id, "at": at}), 5 * USDC, T0 + 150 * SEC), 0);
    let r = c.get_receipt(id).unwrap();
    assert_eq!(r.amount.0, 40 * USDC);
    assert_eq!(r.status, Status::PartiallyReleased);
    assert_eq!(
        r.schedule.iter().map(|t| t.at.0 - T0).collect::<Vec<_>>(),
        [0, 100 * SEC, 100 * SEC, 150 * SEC, 300 * SEC]
    );
    assert_eq!(c.get_config().allocated.0, 20 * USDC);
}

// ------------------------------------------------------------------- release

#[test]
#[should_panic(expected = "refund window still open")]
fn release_before_window_fails() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), USDC, T0);
    ctx("anyone.near", T0 + (WINDOW - 1) * SEC);
    let _ = c.release(1);
}

#[test]
fn release_after_window_and_rollback() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 10 * USDC, T0);
    let now = T0 + WINDOW * SEC;

    // optimistic update while the transfer is in flight
    ctx("anyone.near", now);
    let _ = c.release(1);
    let r = c.get_receipt(1).unwrap();
    assert_eq!((r.released.0, r.in_flight.0, r.status), (10 * USDC, 10 * USDC, Status::Released));
    assert_eq!(c.get_config().allocated.0, 0);

    // failed transfer: everything is restored
    assert!(!resolve(&mut c, 1, TransferKind::Release, vec![], "payout.near", now, false));
    assert!(has_event("transfer_failed"));
    let r = c.get_receipt(1).unwrap();
    assert_eq!((r.released.0, r.in_flight.0, r.status), (0, 0, Status::Held));
    let cfg = c.get_config();
    assert_eq!((cfg.allocated.0, cfg.in_flight_total.0), (10 * USDC, 0));

    assert!(release(&mut c, 1, now, true));
    assert!(has_event("released"));
    let r = c.get_receipt(1).unwrap();
    assert_eq!((r.released.0, r.in_flight.0, r.status), (10 * USDC, 0, Status::Released));
    let cfg = c.get_config();
    assert_eq!((cfg.allocated.0, cfg.in_flight_total.0), (0, 0));
}

#[test]
#[should_panic(expected = "nothing to release")]
fn release_twice_fails() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), USDC, T0);
    release(&mut c, 1, T0 + WINDOW * SEC, true);
    ctx("anyone.near", T0 + WINDOW * SEC);
    let _ = c.release(1);
}

#[test]
#[should_panic(expected = "transfer in flight")]
fn no_double_release_while_in_flight() {
    let mut c = setup();
    paid(&mut c, schedule("s1", &[(T0, USDC), (T0 + SEC, USDC)]), 2 * USDC, T0);
    ctx("anyone.near", T0);
    let _ = c.release(1);
    ctx("anyone.near", T0 + SEC);
    let _ = c.release(1);
}

#[test]
#[should_panic(expected = "contract is paused")]
fn pause_blocks_release() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), USDC, T0);
    ctx("owner.near", T0);
    c.pause();
    ctx("anyone.near", T0 + WINDOW * SEC);
    let _ = c.release(1);
}

#[test]
#[should_panic(expected = "refund request active")]
fn release_blocked_while_request_active() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 10 * USDC, T0);
    request(&mut c, 1, USDC, T0 + SEC);
    ctx("anyone.near", T0 + WINDOW * SEC);
    let _ = c.release(1);
}

#[test]
fn confirm_received_releases_early() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 10 * USDC, T0);
    ctx("relayer.near", T0 + SEC);
    c.confirm_received(1, sign(1, "confirm_received", "", 0));
    assert!(has_event("confirmed"));
    let r = c.get_receipt(1).unwrap();
    assert!(r.confirmed);
    assert_eq!(r.nonce, 1);
    assert!(release(&mut c, 1, T0 + 2 * SEC, true));
    assert_eq!(c.get_receipt(1).unwrap().status, Status::Released);
}

#[test]
#[should_panic(expected = "receipt was confirmed as received")]
fn no_refund_request_after_confirmation() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 10 * USDC, T0);
    ctx("relayer.near", T0 + SEC);
    c.confirm_received(1, sign(1, "confirm_received", "", 0));
    request(&mut c, 1, USDC, T0 + 2 * SEC);
}

#[test]
#[should_panic(expected = "refund window is over")]
fn no_refund_request_after_window() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 10 * USDC, T0);
    request(&mut c, 1, USDC, T0 + WINDOW * SEC);
}

#[test]
fn schedule_releases_due_tranches_and_rolls_back() {
    let mut c = setup();
    let msg = schedule(
        "s1",
        &[(T0, 3 * USDC), (T0 + 10 * SEC, 3 * USDC), (T0 + 20 * SEC, 4 * USDC)],
    );
    paid(&mut c, msg, 10 * USDC, T0);
    assert!(release(&mut c, 1, T0, true));

    assert!(!release(&mut c, 1, T0 + 10 * SEC, false));
    let r = c.get_receipt(1).unwrap();
    assert_eq!((r.status, r.released.0), (Status::PartiallyReleased, 3 * USDC));
    assert_eq!(
        states(&c, 1),
        [TrancheState::Released, TrancheState::Pending, TrancheState::Pending]
    );
    assert_eq!(c.get_config().allocated.0, 7 * USDC);

    assert!(release(&mut c, 1, T0 + 20 * SEC, true));
    assert_eq!(c.get_receipt(1).unwrap().status, Status::Released);
    assert_eq!(c.get_config().allocated.0, 0);
}

// ------------------------------------------------------------- request flow

#[test]
fn ai_approve_veto_window_finalize_execute() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    request(&mut c, 1, 15 * USDC, T0 + SEC);
    assert!(has_event("refund_requested"));
    let q = c.get_receipt(1).unwrap().request.unwrap();
    assert_eq!(q.state, RequestState::Open);
    assert_eq!(q.decision_deadline.0, T0 + SEC + RESPONSE * SEC);
    assert_eq!((q.amount.0, q.reason_hash.as_str(), q.is_cancel, q.by_merchant), (15 * USDC, REASON, false, false));

    // partial approval of 12 USDC
    decide(&mut c, 1, "partial", 12 * USDC, T0 + 2 * SEC);
    assert!(has_event("ai_decided"));
    let q = c.get_receipt(1).unwrap().request.unwrap();
    assert_eq!(q.state, RequestState::AiApproved);
    assert_eq!(q.amount.0, 12 * USDC);
    assert_eq!(q.veto_until.unwrap().0, T0 + 2 * SEC + VETO * SEC);
    assert_eq!(q.summary_hash.as_deref(), Some("bb22"));

    ctx("anyone.near", T0 + 2 * SEC + VETO * SEC);
    c.finalize_request(1);
    assert!(has_event("request_finalized"));
    assert_eq!(req_state(&c, 1), RequestState::Approved);

    let now = T0 + 40 * SEC;
    assert!(execute(&mut c, 1, 12 * USDC, now, true));
    assert!(has_event("refund_executed"));
    assert!(get_logs().iter().any(|l| l.contains("\"quote_id\":\"quote-1\"")));
    let r = c.get_receipt(1).unwrap();
    assert_eq!((r.refunded.0, r.status), (12 * USDC, Status::PartiallyRefunded));
    assert_eq!(r.request.unwrap().state, RequestState::Executed);
    assert_eq!(c.get_config().allocated.0, 18 * USDC);
    assert_eq!(c.get_merchant(acc("shop.near")).unwrap().refunded_today.0, 12 * USDC);

    // the rest goes to the merchant after the window; a new request was possible until then
    assert!(release(&mut c, 1, T0 + WINDOW * SEC, true));
    let r = c.get_receipt(1).unwrap();
    assert_eq!((r.released.0, r.refunded.0), (18 * USDC, 12 * USDC));
    assert_eq!(c.get_config().allocated.0, 0);
}

#[test]
#[should_panic(expected = "veto window still open")]
fn finalize_during_veto_window_fails() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    request(&mut c, 1, 15 * USDC, T0 + SEC);
    decide(&mut c, 1, "approve", 15 * USDC, T0 + 2 * SEC);
    ctx("anyone.near", T0 + 2 * SEC + VETO * SEC - 1);
    c.finalize_request(1);
}

#[test]
fn full_refund_after_second_request() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    request(&mut c, 1, 10 * USDC, T0 + SEC);
    decide(&mut c, 1, "approve", 10 * USDC, T0 + SEC);
    ctx("anyone.near", T0 + SEC + VETO * SEC);
    c.finalize_request(1);
    assert!(execute(&mut c, 1, 10 * USDC, T0 + 32 * SEC, true));
    // an Executed request does not block a new one
    request(&mut c, 1, 20 * USDC, T0 + 33 * SEC);
    ctx("approver.near", T0 + 34 * SEC);
    c.approve_refund(1);
    assert!(has_event("refund_approved"));
    assert!(execute(&mut c, 1, 20 * USDC, T0 + 35 * SEC, true));
    let r = c.get_receipt(1).unwrap();
    assert_eq!((r.status, r.refunded.0), (Status::Refunded, 30 * USDC));
    assert_eq!(c.get_config().allocated.0, 0);
}

#[test]
fn ai_approval_above_limits_escalates() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 100 * USDC, T0);
    request(&mut c, 1, 60 * USDC, T0 + SEC);
    // 21 > auto_approve_max (20)
    decide(&mut c, 1, "partial", 21 * USDC, T0 + 2 * SEC);
    let q = c.get_receipt(1).unwrap().request.unwrap();
    assert_eq!(q.state, RequestState::Escalated);
    assert_eq!(q.amount.0, 60 * USDC);
    assert_eq!(q.decision_deadline.0, T0 + 2 * SEC + RESPONSE * SEC);
    assert!(q.veto_until.is_none());
}

#[test]
fn guard_threshold_also_escalates() {
    let mut c = setup();
    ctx("shop.near", T0);
    // auto_approve_max 80 but guard 50
    c.register_merchant(
        acc("payout.near"),
        acc("approver.near"),
        U128(50 * USDC),
        WINDOW,
        RESPONSE,
        U128(200 * USDC),
        true,
        U128(80 * USDC),
        VETO,
    );
    paid(&mut c, one_time("o1"), 100 * USDC, T0);
    request(&mut c, 1, 60 * USDC, T0 + SEC);
    decide(&mut c, 1, "approve", 60 * USDC, T0 + 2 * SEC);
    assert_eq!(req_state(&c, 1), RequestState::Escalated);
}

#[test]
fn escalate_then_merchant_approves() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    request(&mut c, 1, 30 * USDC, T0 + SEC);
    decide(&mut c, 1, "escalate", 0, T0 + 2 * SEC);
    assert_eq!(req_state(&c, 1), RequestState::Escalated);
    ctx("approver.near", T0 + 3 * SEC);
    c.approve_refund(1);
    assert_eq!(req_state(&c, 1), RequestState::Approved);
    assert!(execute(&mut c, 1, 30 * USDC, T0 + 4 * SEC, true));
    assert_eq!(c.get_receipt(1).unwrap().status, Status::Refunded);
}

#[test]
fn escalate_then_merchant_rejects_is_final() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    request(&mut c, 1, 30 * USDC, T0 + SEC);
    decide(&mut c, 1, "escalate", 0, T0 + 2 * SEC);
    ctx("approver.near", T0 + 3 * SEC);
    c.reject_refund(1, "item was delivered".into());
    assert!(has_event("refund_rejected"));
    assert_eq!(req_state(&c, 1), RequestState::Rejected);
    // rejected does not block release
    assert!(release(&mut c, 1, T0 + WINDOW * SEC, true));
    assert_eq!(c.get_receipt(1).unwrap().status, Status::Released);
}

#[test]
#[should_panic(expected = "a refund request already exists")]
fn no_new_request_after_rejection() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    request(&mut c, 1, 30 * USDC, T0 + SEC);
    ctx("approver.near", T0 + 3 * SEC);
    c.reject_refund(1, String::new());
    request(&mut c, 1, 30 * USDC, T0 + 4 * SEC);
}

#[test]
fn deny_then_appeal_once() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    request(&mut c, 1, 30 * USDC, T0 + SEC);
    decide(&mut c, 1, "deny", 0, T0 + 2 * SEC);
    assert_eq!(req_state(&c, 1), RequestState::AiDenied);

    ctx("relayer.near", T0 + 3 * SEC);
    c.appeal(1, sign(1, "appeal", "", 1));
    assert!(has_event("appealed"));
    let q = c.get_receipt(1).unwrap().request.unwrap();
    assert_eq!((q.state, q.appealed), (RequestState::Escalated, true));
    assert_eq!(q.decision_deadline.0, T0 + 3 * SEC + RESPONSE * SEC);
    assert_eq!(c.get_receipt(1).unwrap().nonce, 2);

    // an escalated appeal can still be rejected by the merchant, and that is final
    ctx("approver.near", T0 + 4 * SEC);
    c.reject_refund(1, "no".into());
}

#[test]
#[should_panic(expected = "request is Escalated, expected [AiDenied]")]
fn appeal_only_once() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    request(&mut c, 1, 30 * USDC, T0 + SEC);
    decide(&mut c, 1, "deny", 0, T0 + 2 * SEC);
    ctx("relayer.near", T0 + 3 * SEC);
    c.appeal(1, sign(1, "appeal", "", 1));
    c.appeal(1, sign(1, "appeal", "", 2));
}

#[test]
#[should_panic(expected = "already appealed")]
fn no_second_appeal_after_a_second_denial_path() {
    // appealed -> Escalated -> (hypothetically AiDenied again) must not be appealable
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    request(&mut c, 1, 30 * USDC, T0 + SEC);
    decide(&mut c, 1, "deny", 0, T0 + 2 * SEC);
    ctx("relayer.near", T0 + 3 * SEC);
    c.appeal(1, sign(1, "appeal", "", 1));
    let mut r = c.receipt(1);
    r.request.as_mut().unwrap().state = RequestState::AiDenied;
    c.receipts.insert(1, r);
    c.appeal(1, sign(1, "appeal", "", 2));
}

#[test]
#[should_panic(expected = "funds were already released")]
fn no_appeal_after_release() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    request(&mut c, 1, 30 * USDC, T0 + SEC);
    decide(&mut c, 1, "deny", 0, T0 + 2 * SEC);
    // AiDenied does not block release
    assert!(release(&mut c, 1, T0 + WINDOW * SEC, true));
    ctx("relayer.near", T0 + WINDOW * SEC + SEC);
    c.appeal(1, sign(1, "appeal", "", 1));
}

#[test]
fn merchant_silence_means_approval() {
    let mut c = setup();
    register(&mut c, "plain.near", false);
    let mut msg = one_time("o1");
    msg["merchant_id"] = json!("plain.near");
    paid(&mut c, msg, 30 * USDC, T0);
    request(&mut c, 1, 30 * USDC, T0 + SEC);
    // window passed, but the open request still blocks release
    assert!(c.get_receipt(1).unwrap().request.is_some());
    ctx("anyone.near", T0 + SEC + RESPONSE * SEC);
    c.finalize_request(1);
    assert_eq!(req_state(&c, 1), RequestState::Approved);
    assert!(execute(&mut c, 1, 30 * USDC, T0 + 200 * SEC, true));
}

#[test]
#[should_panic(expected = "decision deadline not reached")]
fn finalize_before_deadline_fails() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    request(&mut c, 1, 30 * USDC, T0 + SEC);
    ctx("anyone.near", T0 + RESPONSE * SEC);
    c.finalize_request(1);
}

#[test]
fn veto_escalates_an_ai_approval() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    request(&mut c, 1, 10 * USDC, T0 + SEC);
    decide(&mut c, 1, "approve", 10 * USDC, T0 + 2 * SEC);
    ctx("approver.near", T0 + 10 * SEC);
    c.veto(1, "customer already got a replacement".into());
    assert!(has_event("vetoed"));
    let q = c.get_receipt(1).unwrap().request.unwrap();
    assert_eq!(q.state, RequestState::Escalated);
    assert_eq!(q.decision_deadline.0, T0 + 10 * SEC + RESPONSE * SEC);
    c.reject_refund(1, "see above".into());
    assert_eq!(req_state(&c, 1), RequestState::Rejected);
}

#[test]
#[should_panic(expected = "veto window is over")]
fn veto_after_window_fails() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    request(&mut c, 1, 10 * USDC, T0 + SEC);
    decide(&mut c, 1, "approve", 10 * USDC, T0 + 2 * SEC);
    ctx("approver.near", T0 + 2 * SEC + VETO * SEC);
    c.veto(1, String::new());
}

#[test]
#[should_panic(expected = "merchant has not enabled AI triage")]
fn ai_decide_needs_ai_triage() {
    let mut c = setup();
    register(&mut c, "plain.near", false);
    let mut msg = one_time("o1");
    msg["merchant_id"] = json!("plain.near");
    paid(&mut c, msg, 30 * USDC, T0);
    request(&mut c, 1, 30 * USDC, T0 + SEC);
    decide(&mut c, 1, "approve", USDC, T0 + 2 * SEC);
}

#[test]
#[should_panic(expected = "executor only")]
fn ai_decide_is_executor_only() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    request(&mut c, 1, 30 * USDC, T0 + SEC);
    ctx("approver.near", T0 + 2 * SEC);
    c.ai_decide(1, "approve".into(), U128(USDC), String::new());
}

#[test]
#[should_panic(expected = "merchant approver only")]
fn approve_is_approver_only() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    request(&mut c, 1, 30 * USDC, T0 + SEC);
    ctx("shop.near", T0 + 2 * SEC);
    c.approve_refund(1);
}

#[test]
#[should_panic(expected = "request is Open, expected [Approved]")]
fn execute_needs_an_approved_request() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    request(&mut c, 1, 30 * USDC, T0 + SEC);
    ctx("executor.near", T0 + 2 * SEC);
    let _ = c.execute_refund(1, acc("sink.near"), U128(30 * USDC), "q".into());
}

#[test]
#[should_panic(expected = "executor only")]
fn execute_is_executor_only() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    ctx("approver.near", T0 + SEC);
    c.merchant_refund(1, U128(USDC));
    let _ = c.execute_refund(1, acc("approver.near"), U128(USDC), "q".into());
}

#[test]
#[should_panic(expected = "amount must equal the request amount")]
fn execute_amount_must_match() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    ctx("approver.near", T0 + SEC);
    c.merchant_refund(1, U128(2 * USDC));
    ctx("executor.near", T0 + 2 * SEC);
    let _ = c.execute_refund(1, acc("sink.near"), U128(3 * USDC), "q".into());
}

#[test]
fn execute_rolls_back_to_approved_and_works_while_paused() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    ctx("approver.near", T0 + SEC);
    c.merchant_refund(1, U128(10 * USDC));
    let q = c.get_receipt(1).unwrap().request.unwrap();
    assert_eq!((q.state, q.by_merchant), (RequestState::Approved, true));
    ctx("owner.near", T0 + SEC);
    c.pause();
    assert!(has_event("paused"));

    // optimistic state while in flight
    ctx("executor.near", T0 + 2 * SEC);
    let _ = c.execute_refund(1, acc("sink.near"), U128(10 * USDC), "quote-1".into());
    let r = c.get_receipt(1).unwrap();
    assert_eq!((r.refunded.0, r.in_flight.0), (10 * USDC, 10 * USDC));
    assert_eq!(r.request.unwrap().state, RequestState::Executed);
    assert_eq!(c.get_merchant(acc("shop.near")).unwrap().refunded_today.0, 10 * USDC);

    assert!(!resolve(&mut c, 1, TransferKind::Refund, vec![], "sink.near", T0 + 2 * SEC, false));
    let r = c.get_receipt(1).unwrap();
    assert_eq!((r.refunded.0, r.in_flight.0, r.status), (0, 0, Status::Held));
    assert_eq!(r.request.unwrap().state, RequestState::Approved);
    let cfg = c.get_config();
    assert_eq!((cfg.allocated.0, cfg.in_flight_total.0), (30 * USDC, 0));
    assert_eq!(c.get_merchant(acc("shop.near")).unwrap().refunded_today.0, 0);

    assert!(execute(&mut c, 1, 10 * USDC, T0 + 3 * SEC, true));
    assert_eq!(c.get_receipt(1).unwrap().refunded.0, 10 * USDC);
    assert_eq!(c.get_config().allocated.0, 20 * USDC);
}

#[test]
#[should_panic(expected = "transfer in flight")]
fn no_double_refund_while_in_flight() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    ctx("approver.near", T0 + SEC);
    c.merchant_refund(1, U128(10 * USDC));
    ctx("executor.near", T0 + 2 * SEC);
    let _ = c.execute_refund(1, acc("sink.near"), U128(10 * USDC), "q".into());
    let _ = c.execute_refund(1, acc("sink.near"), U128(10 * USDC), "q".into());
}

#[test]
#[should_panic(expected = "transfer in flight")]
fn no_merchant_refund_while_release_in_flight() {
    let mut c = setup();
    paid(&mut c, schedule("s1", &[(T0, USDC), (T0 + 50 * SEC, USDC)]), 2 * USDC, T0);
    ctx("anyone.near", T0);
    let _ = c.release(1);
    ctx("approver.near", T0);
    c.merchant_refund(1, U128(USDC));
}

#[test]
fn daily_refund_cap_uses_utc_day_buckets() {
    let mut c = setup();
    for (i, order) in ["o1", "o2", "o3"].iter().enumerate() {
        paid(&mut c, one_time(order), 150 * USDC, T0);
        ctx("approver.near", T0 + SEC);
        c.merchant_refund(i as u64 + 1, U128(if i == 0 { 150 * USDC } else { 100 * USDC }));
    }
    assert!(execute(&mut c, 1, 150 * USDC, T0 + 2 * SEC, true));
    assert_eq!(c.get_merchant(acc("shop.near")).unwrap().refunded_today.0, 150 * USDC);

    // next UTC day: the bucket is empty again
    ctx("anyone.near", T0 + DAY);
    assert_eq!(c.get_merchant(acc("shop.near")).unwrap().refunded_today.0, 0);
    assert!(execute(&mut c, 2, 100 * USDC, T0 + DAY, true));
    assert!(execute(&mut c, 3, 100 * USDC, T0 + DAY + SEC, true));
    assert_eq!(c.get_merchant(acc("shop.near")).unwrap().refunded_today.0, 200 * USDC);
}

#[test]
#[should_panic(expected = "daily refund cap exceeded")]
fn daily_refund_cap_blocks_the_executor() {
    let mut c = setup();
    for (i, order) in ["o1", "o2"].iter().enumerate() {
        paid(&mut c, one_time(order), 150 * USDC, T0);
        ctx("approver.near", T0 + SEC);
        c.merchant_refund(i as u64 + 1, U128(if i == 0 { 150 * USDC } else { 100 * USDC }));
    }
    execute(&mut c, 1, 150 * USDC, T0 + 2 * SEC, true);
    // 150 + 100 > 200
    ctx("executor.near", T0 + 3 * SEC);
    let _ = c.execute_refund(2, acc("sink.near"), U128(100 * USDC), "q".into());
}

// ------------------------------------------------------ merchant_refund, cancel

#[test]
fn merchant_refund_needs_no_customer_key() {
    let mut c = setup();
    let mut msg = one_time("o1");
    msg.as_object_mut().unwrap().remove("receipt_key");
    paid(&mut c, msg, 30 * USDC, T0);
    // also allowed after the window, as long as the funds are unreleased
    ctx("approver.near", T0 + WINDOW * SEC + SEC);
    c.merchant_refund(1, U128(30 * USDC));
    assert!(has_event("refund_approved"));
    assert!(execute(&mut c, 1, 30 * USDC, T0 + WINDOW * SEC + 2 * SEC, true));
    assert_eq!(c.get_receipt(1).unwrap().status, Status::Refunded);
}

#[test]
#[should_panic(expected = "amount exceeds unreleased funds")]
fn merchant_refund_only_unreleased_funds() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    release(&mut c, 1, T0 + WINDOW * SEC, true);
    ctx("approver.near", T0 + WINDOW * SEC + SEC);
    c.merchant_refund(1, U128(USDC));
}

#[test]
fn merchant_refund_of_schedule_takes_all_pending_tranches() {
    let mut c = setup();
    let msg = schedule("s1", &[(T0, 10 * USDC), (T0 + 10 * SEC, 10 * USDC), (T0 + 20 * SEC, 10 * USDC)]);
    paid(&mut c, msg, 30 * USDC, T0);
    release(&mut c, 1, T0, true);
    ctx("approver.near", T0 + 15 * SEC);
    c.merchant_refund(1, U128(20 * USDC));
    assert_eq!(
        states(&c, 1),
        [TrancheState::Released, TrancheState::RefundPending, TrancheState::RefundPending]
    );
    assert!(execute(&mut c, 1, 20 * USDC, T0 + 16 * SEC, true));
    let r = c.get_receipt(1).unwrap();
    assert_eq!((r.released.0, r.refunded.0, r.status), (10 * USDC, 20 * USDC, Status::PartiallyRefunded));
}

#[test]
fn cancel_refunds_only_future_tranches() {
    let mut c = setup();
    let msg = schedule(
        "s1",
        &[
            (T0, 10 * USDC),
            (T0 + 10 * SEC, 10 * USDC),
            (T0 + 20 * SEC, 10 * USDC),
            (T0 + 30 * SEC, 10 * USDC),
        ],
    );
    paid(&mut c, msg, 40 * USDC, T0);
    assert!(release(&mut c, 1, T0 + SEC, true));

    // At T0+15s: tranche 2 is due but unreleased (stays with merchant), 3 and 4 are requested.
    cancel(&mut c, 1, T0 + 15 * SEC);
    assert!(has_event("cancelled"));
    assert!(has_event("refund_requested"));
    let q = c.get_receipt(1).unwrap().request.unwrap();
    assert_eq!((q.amount.0, q.is_cancel, q.state), (20 * USDC, true, RequestState::Open));
    assert_eq!(
        states(&c, 1),
        [
            TrancheState::Released,
            TrancheState::Pending,
            TrancheState::RefundPending,
            TrancheState::RefundPending
        ]
    );

    // 20 USDC <= auto_approve_max: AI approves, veto window passes, refund is executed
    decide(&mut c, 1, "approve", 20 * USDC, T0 + 16 * SEC);
    ctx("anyone.near", T0 + 16 * SEC + VETO * SEC);
    c.finalize_request(1);
    assert!(execute(&mut c, 1, 20 * USDC, T0 + 50 * SEC, true));
    assert_eq!(states(&c, 1)[3], TrancheState::Refunded);

    // the due tranche still belongs to the merchant
    assert!(release(&mut c, 1, T0 + 51 * SEC, true));
    let r = c.get_receipt(1).unwrap();
    assert_eq!((r.released.0, r.refunded.0, r.status), (20 * USDC, 20 * USDC, Status::PartiallyRefunded));
    assert_eq!(c.get_config().allocated.0, 0);
}

#[test]
#[should_panic(expected = "a cancel request cannot be approved partially")]
fn cancel_cannot_be_partially_approved() {
    let mut c = setup();
    paid(&mut c, schedule("s1", &[(T0 + 10 * SEC, 10 * USDC)]), 10 * USDC, T0);
    cancel(&mut c, 1, T0 + SEC);
    decide(&mut c, 1, "partial", 5 * USDC, T0 + 2 * SEC);
}

#[test]
fn denied_cancel_restores_tranches_and_appeal_marks_them_again() {
    let mut c = setup();
    let msg = schedule("s1", &[(T0 + 10 * SEC, 10 * USDC), (T0 + 20 * SEC, 10 * USDC)]);
    paid(&mut c, msg, 20 * USDC, T0);
    cancel(&mut c, 1, T0 + SEC);
    decide(&mut c, 1, "deny", 0, T0 + 2 * SEC);
    assert_eq!(states(&c, 1), [TrancheState::Pending, TrancheState::Pending]);

    // the first tranche becomes due and is released before the appeal
    assert!(release(&mut c, 1, T0 + 10 * SEC, true));
    ctx("relayer.near", T0 + 11 * SEC);
    c.appeal(1, sign(1, "appeal", "", 1));
    let q = c.get_receipt(1).unwrap().request.unwrap();
    assert_eq!((q.state, q.amount.0), (RequestState::Escalated, 10 * USDC));
    assert_eq!(states(&c, 1), [TrancheState::Released, TrancheState::RefundPending]);

    ctx("approver.near", T0 + 12 * SEC);
    c.reject_refund(1, "used the service".into());
    assert_eq!(states(&c, 1), [TrancheState::Released, TrancheState::Pending]);
}

#[test]
#[should_panic(expected = "use request_refund for OneTime receipts")]
fn cancel_rejects_one_time() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 10 * USDC, T0);
    cancel(&mut c, 1, T0 + SEC);
}

#[test]
#[should_panic(expected = "use cancel for Subscription/Schedule receipts")]
fn request_refund_rejects_schedules() {
    let mut c = setup();
    paid(&mut c, schedule("s1", &[(T0 + SEC, USDC)]), USDC, T0);
    request(&mut c, 1, USDC, T0);
}

// ---------------------------------------------------------------- signatures

#[test]
#[should_panic(expected = "invalid signature")]
fn signature_replay_is_rejected() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    let sig = sign(1, "set_refund_target", "base|usdc|0xb0b", 0);
    let target = RefundTarget {
        chain: "base".into(),
        asset: "usdc".into(),
        address: "0xb0b".into(),
    };
    ctx("relayer.near", T0 + SEC);
    c.set_refund_target(1, target.clone(), sig.clone());
    assert!(has_event("refund_target_changed"));
    assert_eq!(c.get_receipt(1).unwrap().nonce, 1);
    c.set_refund_target(1, target, sig);
}

#[test]
#[should_panic(expected = "invalid signature")]
fn tampered_amount_is_rejected() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    ctx("relayer.near", T0 + SEC);
    let sig = sign(1, "request_refund", &format!("{}|{REASON}", USDC), 0);
    c.request_refund(1, U128(30 * USDC), REASON.into(), sig);
}

#[test]
#[should_panic(expected = "invalid signature")]
fn tampered_claim_account_is_rejected() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    ctx("thief.near", T0 + SEC);
    c.claim(1, acc("thief.near"), sign(1, "claim", "alice.near", 0).unwrap());
}

#[test]
#[should_panic(expected = "invalid signature")]
fn signature_for_another_action_is_rejected() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    ctx("thief.near", T0 + SEC);
    c.confirm_received(1, sign(1, "appeal", "", 0));
}

#[test]
#[should_panic(expected = "invalid signature")]
fn signature_for_another_receipt_is_rejected() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    paid(&mut c, one_time("o2"), 30 * USDC, T0);
    ctx("thief.near", T0 + SEC);
    c.confirm_received(2, sign(1, "confirm_received", "", 0));
}

#[test]
#[should_panic(expected = "sig required for unclaimed receipt")]
fn unclaimed_receipt_needs_a_signature() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    ctx("relayer.near", T0 + SEC);
    c.request_refund(1, U128(USDC), REASON.into(), None);
}

// ------------------------------------------------------------ claim and owner

#[test]
fn claim_then_owner_acts_without_signatures() {
    let mut c = setup();
    let mut msg = one_time("o1");
    msg["transferable"] = json!(true);
    paid(&mut c, msg, 30 * USDC, T0);

    ctx("relayer.near", T0 + SEC);
    c.claim(1, acc("alice.near"), sign(1, "claim", "alice.near", 0).unwrap());
    assert!(has_event("claimed"));
    let r = c.get_receipt(1).unwrap();
    assert_eq!((r.owner_id.clone(), r.claimed, r.receipt_key), (acc("alice.near"), true, None));

    ctx_deposit("alice.near", T0 + 2 * SEC, NearToken::from_yoctonear(1));
    c.nft_transfer(acc("bob.near"), "1".into(), None, None);
    assert_eq!(c.receipts_for_owner(acc("bob.near"), None, None).len(), 1);
    assert!(c.receipts_for_owner(acc("alice.near"), None, None).is_empty());

    ctx("bob.near", T0 + 3 * SEC);
    c.set_refund_target(
        1,
        RefundTarget {
            chain: "base".into(),
            asset: "usdc".into(),
            address: "0xb0b".into(),
        },
        None,
    );
    c.request_refund(1, U128(USDC), REASON.into(), None);
    let r = c.get_receipt(1).unwrap();
    assert_eq!(r.refund_target.chain, "base");
    assert_eq!(r.request.unwrap().state, RequestState::Open);
}

#[test]
#[should_panic(expected = "not the receipt owner")]
fn previous_owner_loses_rights() {
    let mut c = setup();
    let mut msg = one_time("o1");
    msg["transferable"] = json!(true);
    paid(&mut c, msg, 30 * USDC, T0);
    ctx("relayer.near", T0 + SEC);
    c.claim(1, acc("alice.near"), sign(1, "claim", "alice.near", 0).unwrap());
    ctx_deposit("alice.near", T0 + 2 * SEC, NearToken::from_yoctonear(1));
    c.nft_transfer(acc("bob.near"), "1".into(), None, None);
    ctx("alice.near", T0 + 3 * SEC);
    c.request_refund(1, U128(USDC), REASON.into(), None);
}

#[test]
#[should_panic(expected = "receipt is not transferable")]
fn one_time_receipts_are_not_transferable_by_default() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    // claiming is still allowed
    ctx("relayer.near", T0 + SEC);
    c.claim(1, acc("alice.near"), sign(1, "claim", "alice.near", 0).unwrap());
    ctx_deposit("alice.near", T0 + 2 * SEC, NearToken::from_yoctonear(1));
    c.nft_transfer(acc("bob.near"), "1".into(), None, None);
}

#[test]
#[should_panic(expected = "receipt already claimed")]
fn claim_twice_fails() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    ctx("relayer.near", T0 + SEC);
    c.claim(1, acc("alice.near"), sign(1, "claim", "alice.near", 0).unwrap());
    c.claim(1, acc("alice.near"), sign(1, "claim", "alice.near", 1).unwrap());
}

#[test]
#[should_panic(expected = "cannot transfer a receipt to the contract account")]
fn cannot_transfer_back_to_contract() {
    let mut c = setup();
    paid(&mut c, schedule("s1", &[(T0 + SEC, USDC)]), USDC, T0);
    ctx("relayer.near", T0 + SEC);
    c.claim(1, acc("alice.near"), sign(1, "claim", "alice.near", 0).unwrap());
    ctx_deposit("alice.near", T0 + 2 * SEC, NearToken::from_yoctonear(1));
    c.nft_transfer(acc("receipts.near"), "1".into(), None, None);
}

#[test]
#[should_panic(expected = "a refund is approved and about to be executed")]
fn refund_target_is_frozen_once_approved() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), 30 * USDC, T0);
    ctx("approver.near", T0 + SEC);
    c.merchant_refund(1, U128(USDC));
    ctx("relayer.near", T0 + 2 * SEC);
    c.set_refund_target(
        1,
        RefundTarget {
            chain: "base".into(),
            asset: "usdc".into(),
            address: "0xb0b".into(),
        },
        sign(1, "set_refund_target", "base|usdc|0xb0b", 0),
    );
}

// --------------------------------------------------------------------- admin

#[test]
fn register_merchant_update_keeps_balances() {
    let mut c = setup();
    paid(&mut c, one_time("o1"), USDC, T0);
    ctx_deposit("shop.near", T0, NearToken::from_near(1));
    c.register_merchant(
        acc("payout2.near"),
        acc("approver.near"),
        U128(1),
        5,
        6,
        U128(7),
        false,
        U128(8),
        9,
    );
    let m = c.get_merchant(acc("shop.near")).unwrap();
    assert_eq!((m.payout, m.receipt_count), (acc("payout2.near"), 1));
    assert_eq!((m.default_window_secs, m.response_secs, m.veto_secs), (5, 6, 9));
    assert_eq!((m.daily_refund_cap.0, m.auto_approve_max.0, m.ai_triage), (7, 8, false));
    assert_eq!(
        m.storage_balance.0,
        NearToken::from_near(2).as_yoctonear() - RECEIPT_STORAGE_COST
    );
}

#[test]
#[should_panic(expected = "owner only")]
fn pause_is_owner_only() {
    let mut c = setup();
    ctx("executor.near", T0);
    c.pause();
}

#[test]
fn owner_can_unpause_and_rotate_executor() {
    let mut c = setup();
    ctx("owner.near", T0);
    c.pause();
    assert!(c.get_config().paused);
    c.unpause();
    assert!(has_event("unpaused"));
    assert!(!c.get_config().paused);
    c.set_executor(acc("executor2.near"));
    assert_eq!(c.get_config().executor, acc("executor2.near"));
}
