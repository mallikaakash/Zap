//! Zap receipt contract.
//!
//! Every payment is a NEP-171 receipt token that holds USDC until it is released to the
//! merchant or refunded to the customer. The binding interface is `contracts/INTERFACE.md`.

mod events;
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
use near_sdk::serde_json;
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError, PromiseOrValue,
};

pub(crate) use events::Event;
pub use types::*;

pub const EVENT_STANDARD: &str = "universal_checkout";
pub const EVENT_VERSION: &str = "1.0.0";

/// Default storage charge per minted receipt (yoctoNEAR), taken from the merchant's prepaid
/// `storage_balance`. Measured in the sandbox (`storage_cost_per_receipt_is_measured`), with a
/// 64-hex order_ref and a long 1Click refund asset: a Subscription receipt with 3 tranches adds
/// 1,135 bytes of state (OneTime 1,060) for a 12-character merchant id, and 1,291 bytes for a
/// 64-character one. 1,135 bytes + 20% ≈ 1,362, rounded up to 1,400 bytes at 1e19 yoctoNEAR
/// per byte; that also covers the 64-character case. Owner-settable.
pub const DEFAULT_RECEIPT_STORAGE_COST: u128 = 14_000_000_000_000_000_000_000; // 0.014 NEAR
/// Default per-receipt cap: 1,000 USDC (6 decimals). Owner-settable.
pub const DEFAULT_MAX_RECEIPT_AMOUNT: u128 = 1_000_000_000;

const GAS_FT_BALANCE_OF: Gas = Gas::from_tgas(10);
const GAS_MINT_CALLBACK: Gas = Gas::from_tgas(30);
const GAS_MINT_FAILED: Gas = Gas::from_tgas(3);
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(20);
const GAS_TRANSFER_CALLBACK: Gas = Gas::from_tgas(30);
const GAS_WITHDRAW_RESOLVED: Gas = Gas::from_tgas(10);
/// The withdraw balance callback starts the transfer and its resolve callback.
const GAS_WITHDRAW_CALLBACK: Gas = Gas::from_tgas(50);
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
    /// Running total of USDC that has left, or is about to leave, the contract outside
    /// `in_flight_total`: successful transfers, plus direct payments `ft_on_transfer` returned
    /// (the token contract refunds those afterwards). Only its growth is ever used.
    settled_total: u128,
    /// True while a `mint_receipt` or `withdraw_unassigned` balance check is in flight.
    mint_lock: bool,
    paused: bool,
    /// Number of receipts minted. Receipt ids are 1..=receipt_count.
    receipt_count: u64,
    /// yoctoNEAR charged to the merchant's `storage_balance` per minted receipt.
    receipt_storage_cost: u128,
    /// Largest receipt total (USDC minor units) accepted on any payment path, top-ups included.
    max_receipt_amount: u128,
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
            receipt_storage_cost: DEFAULT_RECEIPT_STORAGE_COST,
            max_receipt_amount: DEFAULT_MAX_RECEIPT_AMOUNT,
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

    /// Owner only: hand the contract to another owner account.
    pub fn set_owner(&mut self, owner: AccountId) {
        self.assert_owner();
        config_changed("owner", owner.as_str());
        self.owner = owner;
    }

    /// Owner only: replace the executor (settlement worker) account.
    pub fn set_executor(&mut self, executor: AccountId) {
        self.assert_owner();
        config_changed("executor", executor.as_str());
        self.executor = executor;
    }

    /// Owner only: yoctoNEAR charged per minted receipt from the merchant's `storage_balance`.
    pub fn set_receipt_storage_cost(&mut self, amount: U128) {
        self.assert_owner();
        config_changed("receipt_storage_cost", &amount.0.to_string());
        self.receipt_storage_cost = amount.0;
    }

    /// Owner only: largest receipt total (USDC minor units) accepted on any payment path.
    pub fn set_max_receipt_amount(&mut self, amount: U128) {
        self.assert_owner();
        config_changed("max_receipt_amount", &amount.0.to_string());
        self.max_receipt_amount = amount.0;
    }

    /// Owner only. Stops mints and releases. Refund requests, decisions and execution keep working.
    pub fn pause(&mut self) {
        self.assert_owner();
        self.paused = true;
        Event::new("paused").field("by", &self.owner).emit();
    }

    pub fn unpause(&mut self) {
        self.assert_owner();
        self.paused = false;
        Event::new("unpaused").field("by", &self.owner).emit();
    }

    /// Owner only. Emergency reset in case a `mint_receipt` / `withdraw_unassigned` callback
    /// never ran (out of gas).
    pub fn reset_mint_lock(&mut self) {
        self.assert_owner();
        self.mint_lock = false;
    }

    /// Owner only. Sends USDC that no receipt owns (over-deliveries, plain transfers nobody
    /// minted for) to `to`. Like `mint_receipt` it takes `mint_lock` and reads the contract's
    /// USDC balance; the callback requires `balance >= allocated + in_flight_total + amount`
    /// (plus USDC that left since the call) and then transfers. Fails the transaction if the
    /// surplus is too small. Resolves to `true` if the transfer succeeded, `false` if it failed
    /// (nothing changes in that case).
    pub fn withdraw_unassigned(&mut self, to: AccountId, amount: U128) -> Promise {
        self.assert_owner();
        require!(amount.0 > 0, "amount must be positive");
        require!(!self.mint_lock, "another mint or withdrawal is in flight");
        self.mint_lock = true;
        ext_ft_core::ext(self.usdc.clone())
            .with_static_gas(GAS_FT_BALANCE_OF)
            .ft_balance_of(env::current_account_id())
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_WITHDRAW_CALLBACK)
                    .on_withdraw_balance(to, amount, U128(self.settled_total)),
            )
    }

    /// Never panics, so that `mint_lock` is always cleared.
    #[private]
    pub fn on_withdraw_balance(
        &mut self,
        to: AccountId,
        amount: U128,
        settled_at_init: U128,
        #[callback_result] balance: Result<U128, PromiseError>,
    ) -> PromiseOrValue<bool> {
        self.mint_lock = false;
        match self.check_unassigned(balance, amount.0, settled_at_init.0) {
            Ok(()) => {
                self.in_flight_total += amount.0;
                ext_ft_core::ext(self.usdc.clone())
                    .with_attached_deposit(ONE_YOCTO)
                    .with_static_gas(GAS_FT_TRANSFER)
                    .ft_transfer(to.clone(), amount, Some("unassigned:withdraw".to_string()))
                    .then(
                        Self::ext(env::current_account_id())
                            .with_static_gas(GAS_WITHDRAW_RESOLVED)
                            .on_withdraw_resolved(to, amount),
                    )
                    .into()
            }
            Err(reason) => Self::ext(env::current_account_id())
                .with_static_gas(GAS_MINT_FAILED)
                .mint_failed(reason)
                .into(),
        }
    }

    #[private]
    pub fn on_withdraw_resolved(
        &mut self,
        to: AccountId,
        amount: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        self.in_flight_total -= amount.0;
        let ok = result.is_ok();
        if ok {
            self.settled_total += amount.0;
            Event::new("unassigned_withdrawn")
                .field("to", &to)
                .field("amount", &amount)
                .field("by", &self.owner)
                .emit();
        } else {
            Event::new("transfer_failed")
                .field("receipt_id", &None::<u64>)
                .field("merchant_id", &None::<AccountId>)
                .field("order_ref", &None::<String>)
                .field("amount", &amount)
                .field("action", "withdraw")
                .field("to", &to)
                .field("quote_id", &None::<String>)
                .emit();
        }
        ok
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
        let config = merchant_config(
            payout,
            approver,
            guard_threshold,
            default_window_secs,
            response_secs,
            daily_refund_cap,
            ai_triage,
            auto_approve_max,
            veto_secs,
            true,
        );
        self.upsert_merchant(env::predecessor_account_id(), config);
    }

    /// Owner or executor. Creates or updates the merchant `merchant_id` on its behalf (the
    /// seller never signs anything). Attached NEAR (may be 0) is added to its `storage_balance`.
    /// Refuses a merchant that registered itself with `register_merchant`.
    #[payable]
    #[allow(clippy::too_many_arguments)]
    pub fn register_merchant_for(
        &mut self,
        merchant_id: AccountId,
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
        let caller = env::predecessor_account_id();
        require!(
            caller == self.owner || caller == self.executor,
            "owner or executor only"
        );
        require!(
            !self.merchants.get(&merchant_id).is_some_and(|m| m.self_managed),
            "merchant manages its own registration"
        );
        let config = merchant_config(
            payout,
            approver,
            guard_threshold,
            default_window_secs,
            response_secs,
            daily_refund_cap,
            ai_triage,
            auto_approve_max,
            veto_secs,
            false,
        );
        self.upsert_merchant(merchant_id, config);
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
        let result = self
            .validate_mint(&args, amount, None)
            .and_then(|valid| {
                self.check_unassigned(balance, amount, settled_at_init.0)?;
                Ok(valid)
            });
        match result {
            Ok(valid) => PromiseOrValue::Value(self.do_mint(&args, amount, valid)),
            Err(reason) => Self::ext(env::current_account_id())
                .with_static_gas(GAS_MINT_FAILED)
                .mint_failed(reason)
                .into(),
        }
    }

    /// Private helper whose only job is to fail the `mint_receipt` / `withdraw_unassigned`
    /// transaction with a reason.
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
                TransferKind::Release => receipt_event("released", &r)
                    .field("amount", &U128(amount))
                    .field("payout", &to)
                    .field("released_total", &U128(r.released))
                    .field("status", &r.status())
                    .emit(),
                TransferKind::Refund => receipt_event("refund_executed", &r)
                    .field("amount", &U128(amount))
                    .field("deposit_account", &to)
                    .field("quote_id", &quote_id)
                    .field("refund_target", &r.refund_target)
                    .field("refunded_total", &U128(r.refunded))
                    .field("status", &r.status())
                    .emit(),
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
            receipt_event("transfer_failed", &r)
                .field("amount", &U128(amount))
                .field("action", &kind)
                .field("to", &to)
                .field("quote_id", &quote_id)
                .emit();
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
            self_managed: m.self_managed,
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
            receipt_storage_cost: U128(self.receipt_storage_cost),
            max_receipt_amount: U128(self.max_receipt_amount),
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
        let bytes = msg.as_bytes();
        let head = serde_json::from_slice::<MsgHead>(bytes);
        let result = match &head {
            Err(e) if e.is_syntax() || e.is_eof() => Err("msg is not valid JSON".to_string()),
            Err(e) if msg.contains("\"topup_of\"") => Err(format!("bad top-up msg: {e}")),
            Err(e) => Err(format!("bad mint msg: {e}")),
            Ok(h) if h.topup_of.is_some() => serde_json::from_slice::<TopUpArgs>(bytes)
                .map_err(|e| format!("bad top-up msg: {e}"))
                .and_then(|a| self.top_up(a, amount.0, &sender_id)),
            Ok(_) => serde_json::from_slice::<MintArgs>(bytes)
                .map_err(|e| format!("bad mint msg: {e}"))
                .and_then(|args| {
                    let valid = self.validate_mint(&args, amount.0, Some(&sender_id))?;
                    Ok(self.do_mint(&args, amount.0, valid))
                }),
        };
        match result {
            Ok(_) => PromiseOrValue::Value(U128(0)),
            Err(reason) => {
                // The token contract takes the returned amount back right after this call.
                self.settled_total += amount.0;
                let head = head.ok();
                let head = head.as_ref();
                Event::new("payment_rejected")
                    .field("receipt_id", &head.and_then(|h| h.topup_of))
                    .field("merchant_id", &head.and_then(|h| h.merchant_id.as_ref()))
                    .field("order_ref", &head.and_then(|h| h.order_ref.as_ref()))
                    .field("sender_id", &sender_id)
                    .field("amount", &amount)
                    .field("reason", &reason)
                    .emit();
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

    /// Stores `config` for `merchant_id`, keeping the balances and counters of an existing entry.
    fn upsert_merchant(&mut self, merchant_id: AccountId, mut config: Merchant) {
        if let Some(old) = self.merchants.get(&merchant_id) {
            config.storage_balance += old.storage_balance;
            config.refund_day = old.refund_day;
            config.refunded_today = old.refunded_today;
            config.receipt_count = old.receipt_count;
        }
        Event::new("merchant_registered")
            .field("merchant_id", &merchant_id)
            .field("payout", &config.payout)
            .field("approver", &config.approver)
            .field("by", &env::predecessor_account_id())
            .emit();
        self.merchants.insert(merchant_id, config);
    }

    /// The balance check shared by `mint_receipt` and `withdraw_unassigned`: is there at least
    /// `amount` of USDC that no receipt owns? The balance was read before the callback ran;
    /// USDC that left since then is either still in flight or counted in `settled_total`, and
    /// both are treated as spent.
    fn check_unassigned(
        &self,
        balance: Result<U128, PromiseError>,
        amount: u128,
        settled_at_init: u128,
    ) -> Result<(), String> {
        let balance = balance.map_err(|_| "ft_balance_of failed".to_string())?.0;
        let settled_since = self.settled_total - settled_at_init;
        let required = self.allocated + self.in_flight_total + settled_since + amount;
        if balance >= required {
            Ok(())
        } else {
            Err(format!(
                "insufficient unassigned USDC: balance {balance}, required {required} (allocated {}, in_flight_total {}, amount {amount})",
                self.allocated, self.in_flight_total
            ))
        }
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
            amount <= self.max_receipt_amount,
            "amount above max_receipt_amount",
        )?;
        check(
            merchant.storage_balance >= self.receipt_storage_cost,
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
        merchant.storage_balance -= self.receipt_storage_cost;
        self.merchants.insert(args.merchant_id.clone(), merchant);

        // Storage is covered by the fixed charge above, so no deposit refund logic is needed.
        let token = self.tokens.internal_mint_with_refund(
            id.to_string(),
            env::current_account_id(),
            Some(TokenMetadata {
                title: Some(format!("Receipt #{id}")),
                description: Some(format!("Zap receipt at {}", args.merchant_id)),
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

        receipt_event("receipt_minted", &receipt)
            .field("amount", &U128(amount))
            .field("kind", &receipt.kind)
            .field("window_end", &U64(window_end))
            .field("schedule", &receipt.schedule)
            .field("refund_target", &receipt.refund_target)
            .field("transferable", &receipt.transferable)
            .emit();
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
        check(
            r.amount.saturating_add(amount) <= self.max_receipt_amount,
            "amount above max_receipt_amount",
        )?;
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
        receipt_event("topped_up", &r)
            .field("amount", &U128(amount))
            .field("at", &U64(at))
            .field("total_amount", &U128(r.amount))
            .field("sender_id", sender)
            .emit();
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

/// A merchant entry with fresh balances; `upsert_merchant` carries over the old ones.
#[allow(clippy::too_many_arguments)]
fn merchant_config(
    payout: AccountId,
    approver: AccountId,
    guard_threshold: U128,
    default_window_secs: u64,
    response_secs: u64,
    daily_refund_cap: U128,
    ai_triage: bool,
    auto_approve_max: U128,
    veto_secs: u64,
    self_managed: bool,
) -> Merchant {
    Merchant {
        payout,
        approver,
        guard_threshold: guard_threshold.0,
        default_window_secs,
        response_secs,
        daily_refund_cap: daily_refund_cap.0,
        ai_triage,
        auto_approve_max: auto_approve_max.0,
        veto_secs,
        storage_balance: env::attached_deposit().as_yoctonear(),
        refund_day: 0,
        refunded_today: 0,
        receipt_count: 0,
        self_managed,
    }
}

/// An event that starts with `receipt_id`, `merchant_id` and `order_ref`.
pub(crate) fn receipt_event(name: &str, r: &Receipt) -> Event {
    Event::new(name)
        .field("receipt_id", &r.id)
        .field("merchant_id", &r.merchant_id)
        .field("order_ref", &r.order_ref)
}

/// `config_changed { key, value, by }` for owner settings.
fn config_changed(key: &str, value: &str) {
    Event::new("config_changed")
        .field("key", key)
        .field("value", value)
        .field("by", &env::predecessor_account_id())
        .emit();
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
