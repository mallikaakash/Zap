//! Universal Checkout receipt contract.
//!
//! Every payment is a NEP-171 receipt token that holds USDC until it is released to the
//! merchant or refunded to the customer. The binding interface is `contracts/INTERFACE.md`.

mod nft;
mod refunds;
mod types;

#[cfg(test)]
mod tests;

use near_contract_standards::fungible_token::core::ext_ft_core;
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_contract_standards::non_fungible_token::events::NftMint;
use near_contract_standards::non_fungible_token::metadata::TokenMetadata;
use near_contract_standards::non_fungible_token::NonFungibleToken;
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError, PromiseOrValue,
};

pub use types::*;

pub const EVENT_STANDARD: &str = "universal_checkout";
pub const EVENT_VERSION: &str = "1.0.0";

/// Fixed storage charge per minted receipt, taken from the merchant's prepaid balance.
pub const RECEIPT_STORAGE_COST: u128 = 10_000_000_000_000_000_000_000; // 0.01 NEAR

const GAS_FT_BALANCE_OF: Gas = Gas::from_tgas(10);
const GAS_MINT_CALLBACK: Gas = Gas::from_tgas(30);
const GAS_MINT_FAILED: Gas = Gas::from_tgas(3);
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(20);
const GAS_TRANSFER_CALLBACK: Gas = Gas::from_tgas(30);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);

const MAX_TRANCHES: usize = 60;
const MAX_ORDER_REF_LEN: usize = 64;
const MAX_STRING_LEN: usize = 128;
const MAX_NOTE_LEN: usize = 256;
const DEFAULT_PAGE: u64 = 50;
const MAX_PAGE: u64 = 100;
const NS_PER_SEC: u64 = 1_000_000_000;
const NS_PER_DAY: u64 = 86_400 * NS_PER_SEC;

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    Receipts,
    Merchants,
    MerchantReceipts,
    OrderRefs,
    NftOwnerById,
    NftTokenMetadata,
    NftEnumeration,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    usdc: AccountId,
    executor: AccountId,
    owner: AccountId,
    /// Sum of USDC held for receipts (not released, not refunded).
    allocated: u128,
    /// Sum of outgoing USDC transfers whose callback has not run yet.
    in_flight_total: u128,
    /// Running total of USDC that has left the contract (successful transfers).
    settled_total: u128,
    /// True while a `mint_receipt` balance check is in flight.
    mint_lock: bool,
    paused: bool,
    /// Number of receipts minted. Receipt ids are 1..=receipt_count.
    receipt_count: u64,
    receipts: LookupMap<u64, Receipt>,
    merchants: LookupMap<AccountId, Merchant>,
    /// (merchant, index) -> receipt id
    merchant_receipts: LookupMap<(AccountId, u64), u64>,
    /// order_ref -> receipt id; unique across the contract
    order_refs: LookupMap<String, u64>,
    tokens: NonFungibleToken,
}

/// Mint arguments after validation.
struct ValidMint {
    merchant: Merchant,
    refund_target: RefundTarget,
    receipt_key: Option<[u8; 32]>,
    schedule: Vec<Tranche>,
    window_secs: u64,
    transferable: bool,
}

#[near]
impl Contract {
    #[init]
    pub fn new(usdc: AccountId, executor: AccountId, owner: AccountId) -> Self {
        Self {
            usdc,
            executor,
            owner,
            allocated: 0,
            in_flight_total: 0,
            settled_total: 0,
            mint_lock: false,
            paused: false,
            receipt_count: 0,
            receipts: LookupMap::new(StorageKey::Receipts),
            merchants: LookupMap::new(StorageKey::Merchants),
            merchant_receipts: LookupMap::new(StorageKey::MerchantReceipts),
            order_refs: LookupMap::new(StorageKey::OrderRefs),
            tokens: NonFungibleToken::new(
                StorageKey::NftOwnerById,
                env::current_account_id(),
                Some(StorageKey::NftTokenMetadata),
                Some(StorageKey::NftEnumeration),
                None::<StorageKey>,
            ),
        }
    }

    // ------------------------------------------------------------------ admin

    /// Owner only: replace the executor (settlement worker) account.
    pub fn set_executor(&mut self, executor: AccountId) {
        self.assert_owner();
        self.executor = executor;
    }

    /// Owner only. Stops mints and releases. Refund requests, decisions and execution keep working.
    pub fn pause(&mut self) {
        self.assert_owner();
        self.paused = true;
        emit("paused", json!({ "by": self.owner }));
    }

    pub fn unpause(&mut self) {
        self.assert_owner();
        self.paused = false;
        emit("unpaused", json!({ "by": self.owner }));
    }

    /// Owner only. Emergency reset in case a `mint_receipt` callback never ran (out of gas).
    pub fn reset_mint_lock(&mut self) {
        self.assert_owner();
        self.mint_lock = false;
    }

    // --------------------------------------------------------------- merchant

    /// Create or update the caller's merchant config. The caller is the merchant id.
    /// Attached NEAR is added to the merchant's `storage_balance`.
    #[payable]
    #[allow(clippy::too_many_arguments)]
    pub fn register_merchant(
        &mut self,
        payout: AccountId,
        approver: AccountId,
        guard_threshold: U128,
        default_window_secs: u64,
        response_secs: u64,
        daily_refund_cap: U128,
        ai_triage: bool,
        auto_approve_max: U128,
        veto_secs: u64,
    ) {
        let merchant_id = env::predecessor_account_id();
        let old = self.merchants.get(&merchant_id);
        let merchant = Merchant {
            payout,
            approver,
            guard_threshold: guard_threshold.0,
            default_window_secs,
            response_secs,
            daily_refund_cap: daily_refund_cap.0,
            ai_triage,
            auto_approve_max: auto_approve_max.0,
            veto_secs,
            storage_balance: old.map_or(0, |m| m.storage_balance)
                + env::attached_deposit().as_yoctonear(),
            refund_day: old.map_or(0, |m| m.refund_day),
            refunded_today: old.map_or(0, |m| m.refunded_today),
            receipt_count: old.map_or(0, |m| m.receipt_count),
        };
        self.merchants.insert(merchant_id, merchant);
    }

    /// Anyone. Adds the attached NEAR to a merchant's `storage_balance`.
    #[payable]
    pub fn fund_storage(&mut self, merchant_id: AccountId) {
        let mut m = self.merchant(&merchant_id);
        m.storage_balance += env::attached_deposit().as_yoctonear();
        self.merchants.insert(merchant_id, m);
    }

    // ------------------------------------------------------------------- mint

    /// Executor only. Primary path: the USDC was paid to the contract with a plain transfer.
    /// Reads the contract's USDC balance and mints in the callback if enough unassigned USDC
    /// is present. Resolves to the receipt id; the transaction fails with a reason otherwise.
    pub fn mint_receipt(&mut self, args: MintArgs) -> Promise {
        self.assert_executor();
        require!(!self.mint_lock, "another mint is in flight");
        let amount = args
            .amount
            .unwrap_or_else(|| env::panic_str("amount required"))
            .0;
        if let Err(reason) = self.validate_mint(&args, amount, None) {
            env::panic_str(&reason);
        }
        self.mint_lock = true;
        ext_ft_core::ext(self.usdc.clone())
            .with_static_gas(GAS_FT_BALANCE_OF)
            .ft_balance_of(env::current_account_id())
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_MINT_CALLBACK)
                    .on_mint_balance(args, U128(self.settled_total)),
            )
    }

    /// Never panics on a business failure, so that `mint_lock` is always cleared. A failure is
    /// reported by chaining to `mint_failed`, which fails the transaction with the reason.
    #[private]
    pub fn on_mint_balance(
        &mut self,
        args: MintArgs,
        settled_at_init: U128,
        #[callback_result] balance: Result<U128, PromiseError>,
    ) -> PromiseOrValue<u64> {
        self.mint_lock = false;
        let amount = args.amount.map_or(0, |a| a.0);
        let result = match balance {
            Err(_) => Err("ft_balance_of failed".to_string()),
            Ok(balance) => self.validate_mint(&args, amount, None).and_then(|valid| {
                // The balance was read before this callback ran. USDC that left since then is
                // either still in flight or counted in `settled_total`; treat both as spent.
                let settled_since = self.settled_total - settled_at_init.0;
                let required = self.allocated + self.in_flight_total + settled_since + amount;
                if balance.0 >= required {
                    Ok(valid)
                } else {
                    Err(format!(
                        "insufficient unassigned USDC: balance {}, required {required} (allocated {}, in_flight_total {}, amount {amount})",
                        balance.0, self.allocated, self.in_flight_total
                    ))
                }
            }),
        };
        match result {
            Ok(valid) => PromiseOrValue::Value(self.do_mint(&args, amount, valid)),
            Err(reason) => Self::ext(env::current_account_id())
                .with_static_gas(GAS_MINT_FAILED)
                .mint_failed(reason)
                .into(),
        }
    }

    /// Private helper whose only job is to fail the `mint_receipt` transaction with a reason.
    #[private]
    pub fn mint_failed(&self, reason: String) -> u64 {
        env::panic_str(&reason)
    }

    // ---------------------------------------------------------------- release

    /// Anyone. Pays what is due to the merchant payout account.
    /// Resolves to `true` if the USDC transfer succeeded, `false` if it failed and was rolled back.
    pub fn release(&mut self, id: u64) -> Promise {
        require!(!self.paused, "contract is paused");
        let mut r = self.receipt(id);
        require!(r.in_flight == 0, "transfer in flight");
        require!(!r.has_active_request(), "refund request active");
        let now = env::block_timestamp();
        let mut tranches: Vec<u32> = vec![];
        let amount = match r.kind {
            Kind::OneTime => {
                require!(r.remaining() > 0, "nothing to release");
                require!(
                    r.confirmed || now >= r.window_end,
                    "refund window still open"
                );
                r.remaining()
            }
            Kind::Subscription | Kind::Schedule => {
                let mut due = 0u128;
                for (i, t) in r.schedule.iter_mut().enumerate() {
                    if t.state == TrancheState::Pending && t.at.0 <= now {
                        t.state = TrancheState::Released;
                        due += t.amount.0;
                        tranches.push(i as u32);
                    }
                }
                require!(due > 0, "nothing to release");
                due
            }
        };
        let payout = self.merchant(&r.merchant_id).payout;
        r.released += amount;
        r.in_flight = amount;
        self.allocated -= amount;
        self.in_flight_total += amount;
        self.receipts.insert(id, r);
        self.send_usdc(id, TransferKind::Release, amount, tranches, payout, None)
    }

    /// Callback of every outgoing USDC transfer. Success: clears `in_flight`. Failure: restores
    /// the optimistic update made by `release` / `execute_refund`.
    #[private]
    #[allow(clippy::too_many_arguments)]
    pub fn on_transfer_resolved(
        &mut self,
        id: u64,
        kind: TransferKind,
        amount: U128,
        tranches: Vec<u32>,
        to: AccountId,
        quote_id: Option<String>,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        let mut r = self.receipt(id);
        let amount = amount.0;
        r.in_flight -= amount;
        self.in_flight_total -= amount;
        let ok = result.is_ok();
        if ok {
            self.settled_total += amount;
            match kind {
                TransferKind::Release => emit(
                    "released",
                    json!({
                        "receipt_id": id,
                        "merchant_id": r.merchant_id,
                        "order_ref": r.order_ref,
                        "amount": U128(amount),
                        "payout": to,
                        "released_total": U128(r.released),
                        "status": r.status(),
                    }),
                ),
                TransferKind::Refund => emit(
                    "refund_executed",
                    json!({
                        "receipt_id": id,
                        "merchant_id": r.merchant_id,
                        "order_ref": r.order_ref,
                        "amount": U128(amount),
                        "deposit_account": to,
                        "quote_id": quote_id,
                        "refund_target": r.refund_target,
                        "refunded_total": U128(r.refunded),
                        "status": r.status(),
                    }),
                ),
            }
        } else {
            self.allocated += amount;
            let restored = match kind {
                TransferKind::Release => {
                    r.released -= amount;
                    TrancheState::Pending
                }
                TransferKind::Refund => {
                    r.refunded -= amount;
                    if let Some(q) = r.request.as_mut() {
                        q.state = RequestState::Approved;
                    }
                    let mut m = self.merchant(&r.merchant_id);
                    if m.refund_day == env::block_timestamp() / NS_PER_DAY {
                        m.refunded_today = m.refunded_today.saturating_sub(amount);
                        self.merchants.insert(r.merchant_id.clone(), m);
                    }
                    TrancheState::RefundPending
                }
            };
            for i in tranches {
                r.schedule[i as usize].state = restored;
            }
            emit(
                "transfer_failed",
                json!({
                    "receipt_id": id,
                    "merchant_id": r.merchant_id,
                    "order_ref": r.order_ref,
                    "amount": U128(amount),
                    "action": kind,
                    "to": to,
                    "quote_id": quote_id,
                }),
            );
        }
        self.receipts.insert(id, r);
        ok
    }

    // ------------------------------------------------------------------ views

    pub fn get_receipt(&self, id: u64) -> Option<ReceiptView> {
        self.receipts.get(&id).map(|r| self.view(r))
    }

    pub fn get_receipt_by_order_ref(&self, order_ref: String) -> Option<ReceiptView> {
        self.order_refs
            .get(&order_ref)
            .and_then(|id| self.get_receipt(*id))
    }

    /// Receipts of a merchant in mint order.
    pub fn receipts_for_merchant(
        &self,
        merchant_id: AccountId,
        from_index: Option<u64>,
        limit: Option<u64>,
    ) -> Vec<ReceiptView> {
        let count = self.merchants.get(&merchant_id).map_or(0, |m| m.receipt_count);
        let from = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(DEFAULT_PAGE).min(MAX_PAGE);
        (from..count.min(from.saturating_add(limit)))
            .filter_map(|i| self.merchant_receipts.get(&(merchant_id.clone(), i)))
            .filter_map(|id| self.get_receipt(*id))
            .collect()
    }

    /// Receipts whose NFT is owned by `account_id`. Order is not stable across transfers.
    pub fn receipts_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<u64>,
        limit: Option<u64>,
    ) -> Vec<ReceiptView> {
        let Some(set) = self
            .tokens
            .tokens_per_owner
            .as_ref()
            .and_then(|m| m.get(&account_id))
        else {
            return vec![];
        };
        let limit = limit.unwrap_or(DEFAULT_PAGE).min(MAX_PAGE);
        set.iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit as usize)
            .filter_map(|token_id| token_id.parse::<u64>().ok())
            .filter_map(|id| self.get_receipt(id))
            .collect()
    }

    pub fn get_merchant(&self, id: AccountId) -> Option<MerchantView> {
        let today = env::block_timestamp() / NS_PER_DAY;
        self.merchants.get(&id).map(|m| MerchantView {
            payout: m.payout.clone(),
            approver: m.approver.clone(),
            guard_threshold: U128(m.guard_threshold),
            default_window_secs: m.default_window_secs,
            response_secs: m.response_secs,
            daily_refund_cap: U128(m.daily_refund_cap),
            ai_triage: m.ai_triage,
            auto_approve_max: U128(m.auto_approve_max),
            veto_secs: m.veto_secs,
            storage_balance: U128(m.storage_balance),
            refunded_today: U128(if m.refund_day == today { m.refunded_today } else { 0 }),
            receipt_count: m.receipt_count,
        })
    }

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            usdc: self.usdc.clone(),
            executor: self.executor.clone(),
            owner: self.owner.clone(),
            allocated: U128(self.allocated),
            in_flight_total: U128(self.in_flight_total),
            mint_lock: self.mint_lock,
            paused: self.paused,
            receipt_count: self.receipt_count,
            receipt_storage_cost: U128(RECEIPT_STORAGE_COST),
        }
    }
}

#[near]
impl FungibleTokenReceiver for Contract {
    /// Direct USDC path. `msg` is JSON `MintArgs` (without `amount`) or `{"topup_of": id}`.
    /// Returns "0" when the payment was accepted. On any failed check the full amount is
    /// returned so that the token contract refunds the sender.
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        // Any other token is refunded by its own contract when this panics.
        require!(
            env::predecessor_account_id() == self.usdc,
            "only the USDC contract may call ft_on_transfer"
        );
        let parsed: Option<Value> = serde_json::from_str(&msg).ok();
        let field = |name: &str| parsed.as_ref().map_or(Value::Null, |v| v[name].clone());
        let is_topup = parsed.as_ref().is_some_and(|v| v.get("topup_of").is_some());

        let result = match parsed.clone() {
            None => Err("msg is not valid JSON".to_string()),
            Some(v) if is_topup => serde_json::from_value::<TopUpArgs>(v)
                .map_err(|e| format!("bad top-up msg: {e}"))
                .and_then(|a| self.top_up(a, amount.0, &sender_id)),
            Some(v) => serde_json::from_value::<MintArgs>(v)
                .map_err(|e| format!("bad mint msg: {e}"))
                .and_then(|args| {
                    let valid = self.validate_mint(&args, amount.0, Some(&sender_id))?;
                    Ok(self.do_mint(&args, amount.0, valid))
                }),
        };
        match result {
            Ok(_) => PromiseOrValue::Value(U128(0)),
            Err(reason) => {
                emit(
                    "payment_rejected",
                    json!({
                        "receipt_id": field("topup_of"),
                        "merchant_id": field("merchant_id"),
                        "order_ref": field("order_ref"),
                        "sender_id": sender_id,
                        "amount": amount,
                        "reason": reason,
                    }),
                );
                PromiseOrValue::Value(amount)
            }
        }
    }
}

// ------------------------------------------------------------------- internals

impl Contract {
    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
    }

    pub(crate) fn assert_executor(&self) {
        require!(env::predecessor_account_id() == self.executor, "executor only");
    }

    pub(crate) fn assert_approver(&self, r: &Receipt) -> Merchant {
        let m = self.merchant(&r.merchant_id);
        require!(
            env::predecessor_account_id() == m.approver,
            "merchant approver only"
        );
        m
    }

    pub(crate) fn receipt(&self, id: u64) -> Receipt {
        self.receipts
            .get(&id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("receipt not found"))
    }

    pub(crate) fn merchant(&self, id: &AccountId) -> Merchant {
        self.merchants
            .get(id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("merchant not registered"))
    }

    pub(crate) fn owner_of(&self, id: u64) -> AccountId {
        self.tokens
            .owner_by_id
            .get(&id.to_string())
            .unwrap_or_else(|| env::panic_str("receipt not found"))
    }

    /// Checks mint arguments against current state without changing anything.
    /// `sender` is the payer in the `ft_on_transfer` path (default refund target).
    fn validate_mint(
        &self,
        args: &MintArgs,
        amount: u128,
        sender: Option<&AccountId>,
    ) -> Result<ValidMint, String> {
        let check = |cond: bool, msg: &str| if cond { Ok(()) } else { Err(msg.to_string()) };
        check(!self.paused, "contract is paused")?;
        let merchant = self
            .merchants
            .get(&args.merchant_id)
            .cloned()
            .ok_or("merchant not registered")?;
        check(
            !args.order_ref.is_empty() && args.order_ref.len() <= MAX_ORDER_REF_LEN,
            "order_ref must be 1..=64 characters",
        )?;
        check(
            !self.order_refs.contains_key(&args.order_ref),
            "order_ref already used",
        )?;
        check(amount > 0, "amount must be positive")?;
        check(
            merchant.storage_balance >= RECEIPT_STORAGE_COST,
            "merchant storage balance too low",
        )?;

        let inputs = args.schedule.as_deref().unwrap_or(&[]);
        match args.kind {
            Kind::OneTime => check(
                inputs.is_empty(),
                "schedule must be empty for OneTime receipts",
            )?,
            Kind::Subscription | Kind::Schedule => {
                check(
                    !inputs.is_empty() && inputs.len() <= MAX_TRANCHES,
                    "schedule must have 1..=60 tranches",
                )?;
                check(
                    args.window_secs.is_none(),
                    "window_secs is for OneTime receipts",
                )?;
                let mut sum = 0u128;
                for t in inputs {
                    check(t.amount.0 > 0, "tranche amount must be positive")?;
                    sum = sum.checked_add(t.amount.0).ok_or("schedule overflow")?;
                }
                check(sum == amount, "schedule must sum to amount")?;
            }
        }

        let refund_target = match (&args.refund_target, sender) {
            (Some(t), _) => t.clone(),
            (None, Some(sender)) => RefundTarget {
                chain: "near".to_string(),
                asset: self.usdc.to_string(),
                address: sender.to_string(),
            },
            (None, None) => return Err("refund_target required".to_string()),
        };
        check_target(&refund_target)?;
        let receipt_key = match &args.receipt_key {
            None => None,
            Some(k) => Some(from_hex::<32>(k).ok_or("receipt_key must be 64 hex characters")?),
        };
        Ok(ValidMint {
            window_secs: args.window_secs.unwrap_or(merchant.default_window_secs),
            merchant,
            refund_target,
            receipt_key,
            schedule: inputs
                .iter()
                .map(|t| Tranche {
                    at: t.at,
                    amount: t.amount,
                    state: TrancheState::Pending,
                })
                .collect(),
            transferable: args.transferable.unwrap_or(args.kind != Kind::OneTime),
        })
    }

    /// Stores the receipt, charges storage and mints the NFT to the contract account.
    fn do_mint(&mut self, args: &MintArgs, amount: u128, valid: ValidMint) -> u64 {
        let now = env::block_timestamp();
        let id = self.receipt_count + 1;
        self.receipt_count = id;
        let window_end = match args.kind {
            Kind::OneTime => now.saturating_add(valid.window_secs.saturating_mul(NS_PER_SEC)),
            // Schedules have no refund window; tranche times decide.
            _ => now,
        };
        let receipt = Receipt {
            id,
            merchant_id: args.merchant_id.clone(),
            order_ref: args.order_ref.clone(),
            amount,
            released: 0,
            refunded: 0,
            in_flight: 0,
            kind: args.kind,
            window_end,
            created_at: now,
            confirmed: false,
            schedule: valid.schedule,
            refund_target: valid.refund_target,
            receipt_key: valid.receipt_key,
            nonce: 0,
            transferable: valid.transferable,
            request: None,
        };

        self.allocated += amount;
        self.order_refs.insert(args.order_ref.clone(), id);
        let mut merchant = valid.merchant;
        self.merchant_receipts
            .insert((args.merchant_id.clone(), merchant.receipt_count), id);
        merchant.receipt_count += 1;
        merchant.storage_balance -= RECEIPT_STORAGE_COST;
        self.merchants.insert(args.merchant_id.clone(), merchant);

        // Storage is covered by the fixed charge above, so no deposit refund logic is needed.
        let token = self.tokens.internal_mint_with_refund(
            id.to_string(),
            env::current_account_id(),
            Some(TokenMetadata {
                title: Some(format!("Receipt #{id}")),
                description: Some(format!("Universal Checkout receipt at {}", args.merchant_id)),
                copies: Some(1),
                issued_at: Some(now.to_string()),
                ..Default::default()
            }),
            None,
        );
        NftMint {
            owner_id: &token.owner_id,
            token_ids: &[&token.token_id],
            memo: None,
        }
        .emit();

        emit(
            "receipt_minted",
            json!({
                "receipt_id": id,
                "merchant_id": receipt.merchant_id,
                "order_ref": receipt.order_ref,
                "amount": U128(amount),
                "kind": receipt.kind,
                "window_end": U64(window_end),
                "schedule": receipt.schedule,
                "refund_target": receipt.refund_target,
                "transferable": receipt.transferable,
            }),
        );
        self.receipts.insert(id, receipt);
        id
    }

    /// Appends a Pending tranche to a Subscription/Schedule receipt.
    fn top_up(&mut self, args: TopUpArgs, amount: u128, sender: &AccountId) -> Result<u64, String> {
        let check = |cond: bool, msg: &str| if cond { Ok(()) } else { Err(msg.to_string()) };
        check(!self.paused, "contract is paused")?;
        let mut r = self
            .receipts
            .get(&args.topup_of)
            .cloned()
            .ok_or("receipt not found")?;
        check(
            r.kind != Kind::OneTime,
            "top-up is for Subscription/Schedule receipts",
        )?;
        check(amount > 0, "amount must be positive")?;
        check(!r.has_active_request(), "refund request active")?;
        check(r.schedule.len() < MAX_TRANCHES, "schedule is full")?;
        let now = env::block_timestamp();
        let last = r.schedule.last().map_or(0, |t| t.at.0);
        let at = args.at.map_or(now.max(last), |a| a.0);
        r.schedule.push(Tranche {
            at: U64(at),
            amount: U128(amount),
            state: TrancheState::Pending,
        });
        r.amount += amount;
        self.allocated += amount;
        emit(
            "topped_up",
            json!({
                "receipt_id": r.id,
                "merchant_id": r.merchant_id,
                "order_ref": r.order_ref,
                "amount": U128(amount),
                "at": U64(at),
                "total_amount": U128(r.amount),
                "sender_id": sender,
            }),
        );
        let id = r.id;
        self.receipts.insert(id, r);
        Ok(id)
    }

    /// `ft_transfer` (1 yocto) to `to`, then `on_transfer_resolved`.
    pub(crate) fn send_usdc(
        &self,
        id: u64,
        kind: TransferKind,
        amount: u128,
        tranches: Vec<u32>,
        to: AccountId,
        quote_id: Option<String>,
    ) -> Promise {
        let memo = match kind {
            TransferKind::Release => format!("receipt:{id}:release"),
            TransferKind::Refund => format!("receipt:{id}:refund"),
        };
        ext_ft_core::ext(self.usdc.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(to.clone(), U128(amount), Some(memo))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_TRANSFER_CALLBACK)
                    .on_transfer_resolved(id, kind, U128(amount), tranches, to, quote_id),
            )
    }

    /// Holder auth. Claimed receipt: the caller must be the NFT owner (`sig` is ignored).
    /// Unclaimed receipt: `sig` must be a receipt-key signature over this exact action.
    pub(crate) fn authorize_holder(
        &self,
        r: &mut Receipt,
        action: &str,
        params: &str,
        sig: Option<String>,
    ) {
        let owner = self.owner_of(r.id);
        if owner != env::current_account_id() {
            require!(env::predecessor_account_id() == owner, "not the receipt owner");
            return;
        }
        verify_sig(r, action, params, sig);
    }

    fn view(&self, r: &Receipt) -> ReceiptView {
        let owner_id = self.owner_of(r.id);
        ReceiptView {
            id: r.id,
            token_id: r.id.to_string(),
            claimed: owner_id != env::current_account_id(),
            owner_id,
            transferable: r.transferable,
            merchant_id: r.merchant_id.clone(),
            order_ref: r.order_ref.clone(),
            amount: U128(r.amount),
            released: U128(r.released),
            refunded: U128(r.refunded),
            in_flight: U128(r.in_flight),
            kind: r.kind,
            status: r.status(),
            window_end: U64(r.window_end),
            created_at: U64(r.created_at),
            confirmed: r.confirmed,
            schedule: r.schedule.clone(),
            refund_target: r.refund_target.clone(),
            receipt_key: r.receipt_key.map(|k| to_hex(&k)),
            nonce: r.nonce,
            request: r.request.as_ref().map(|q| RequestView {
                amount: U128(q.amount),
                reason_hash: q.reason_hash.clone(),
                summary_hash: q.summary_hash.clone(),
                opened_at: U64(q.opened_at),
                decision_deadline: U64(q.decision_deadline),
                veto_until: q.veto_until.map(U64),
                appealed: q.appealed,
                is_cancel: q.is_cancel,
                by_merchant: q.by_merchant,
                state: q.state,
            }),
        }
    }
}

pub(crate) fn emit(event: &str, data: Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({
            "standard": EVENT_STANDARD,
            "version": EVENT_VERSION,
            "event": event,
            "data": [data],
        })
    ));
}

/// Verifies a receipt-key signature and consumes the nonce.
///
/// `preimage = "uc:v1|{contract_id}|{receipt_id}|{action}|{params}|{nonce}"`, and the
/// signature is ed25519 over `sha256(preimage)`.
pub(crate) fn verify_sig(r: &mut Receipt, action: &str, params: &str, sig: Option<String>) {
    let key = r
        .receipt_key
        .unwrap_or_else(|| env::panic_str("receipt has no receipt_key"));
    let sig = sig.unwrap_or_else(|| env::panic_str("sig required for unclaimed receipt"));
    let sig = from_hex::<64>(&sig).unwrap_or_else(|| env::panic_str("sig must be 128 hex characters"));
    let preimage = format!(
        "uc:v1|{}|{}|{}|{}|{}",
        env::current_account_id(),
        r.id,
        action,
        params,
        r.nonce
    );
    let digest = env::sha256_array(preimage.as_bytes());
    require!(env::ed25519_verify(&sig, digest, &key), "invalid signature");
    r.nonce += 1;
}

fn check_target(t: &RefundTarget) -> Result<(), String> {
    for s in [&t.chain, &t.asset, &t.address] {
        if s.is_empty() || s.len() > MAX_STRING_LEN || s.contains('|') {
            return Err("refund_target fields must be 1..=128 characters without '|'".to_string());
        }
    }
    Ok(())
}

pub(crate) fn assert_target(t: &RefundTarget) {
    if let Err(e) = check_target(t) {
        env::panic_str(&e);
    }
}

/// Hashes are lowercase hex, at most 64 characters (may be empty).
pub(crate) fn assert_hash(name: &str, s: &str) {
    require!(
        s.len() <= 64 && s.bytes().all(|c| matches!(c, b'0'..=b'9' | b'a'..=b'f')),
        format!("{name} must be lowercase hex, at most 64 characters")
    );
}

pub(crate) fn assert_note(s: &str) {
    require!(s.len() <= MAX_NOTE_LEN, "note is too long");
}

pub(crate) fn from_hex<const N: usize>(s: &str) -> Option<[u8; N]> {
    let b = s.as_bytes();
    if b.len() != 2 * N {
        return None;
    }
    let nibble = |c: u8| -> Option<u8> {
        match c {
            b'0'..=b'9' => Some(c - b'0'),
            b'a'..=b'f' => Some(c - b'a' + 10),
            b'A'..=b'F' => Some(c - b'A' + 10),
            _ => None,
        }
    };
    let mut out = [0u8; N];
    for (i, o) in out.iter_mut().enumerate() {
        *o = (nibble(b[2 * i])? << 4) | nibble(b[2 * i + 1])?;
    }
    Some(out)
}

pub(crate) fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0xf) as usize] as char);
    }
    s
}
