use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId};

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    OneTime,
    Subscription,
    Schedule,
}

/// Derived from `amount`, `released` and `refunded`; never stored.
#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Held,
    PartiallyReleased,
    Released,
    PartiallyRefunded,
    Refunded,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrancheState {
    Pending,
    Released,
    /// Part of a refund request; `release` skips it.
    RefundPending,
    Refunded,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RequestState {
    Open,
    AiApproved,
    AiDenied,
    Escalated,
    Approved,
    Rejected,
    Executed,
}

impl RequestState {
    /// Active requests block `release` and block a new request.
    pub fn is_active(self) -> bool {
        matches!(
            self,
            RequestState::Open
                | RequestState::AiApproved
                | RequestState::Escalated
                | RequestState::Approved
        )
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tranche {
    /// Release time, ns since epoch.
    pub at: U64,
    pub amount: U128,
    pub state: TrancheState,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct TrancheInput {
    pub at: U64,
    pub amount: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RefundTarget {
    pub chain: String,
    pub asset: String,
    pub address: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct MintArgs {
    pub merchant_id: AccountId,
    pub order_ref: String,
    /// Required for `mint_receipt`; ignored in `ft_on_transfer` (the transferred amount is used).
    #[serde(default)]
    pub amount: Option<U128>,
    pub kind: Kind,
    #[serde(default)]
    pub window_secs: Option<u64>,
    #[serde(default)]
    pub schedule: Option<Vec<TrancheInput>>,
    #[serde(default)]
    pub refund_target: Option<RefundTarget>,
    #[serde(default)]
    pub receipt_key: Option<String>,
    #[serde(default)]
    pub transferable: Option<bool>,
}

/// `ft_on_transfer` message for a top-up of an existing Subscription/Schedule receipt.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct TopUpArgs {
    pub topup_of: u64,
    #[serde(default)]
    pub at: Option<U64>,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Merchant {
    pub payout: AccountId,
    pub approver: AccountId,
    pub guard_threshold: u128,
    pub default_window_secs: u64,
    pub response_secs: u64,
    pub daily_refund_cap: u128,
    pub ai_triage: bool,
    pub auto_approve_max: u128,
    pub veto_secs: u64,
    /// Prepaid yoctoNEAR for receipt storage.
    pub storage_balance: u128,
    /// UTC day index (`block_timestamp / 86400 s`) that `refunded_today` belongs to.
    pub refund_day: u64,
    pub refunded_today: u128,
    pub receipt_count: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct MerchantView {
    pub payout: AccountId,
    pub approver: AccountId,
    pub guard_threshold: U128,
    pub default_window_secs: u64,
    pub response_secs: u64,
    pub daily_refund_cap: U128,
    pub ai_triage: bool,
    pub auto_approve_max: U128,
    pub veto_secs: u64,
    pub storage_balance: U128,
    pub refunded_today: U128,
    pub receipt_count: u64,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Request {
    pub amount: u128,
    pub reason_hash: String,
    pub summary_hash: Option<String>,
    pub opened_at: u64,
    pub decision_deadline: u64,
    pub veto_until: Option<u64>,
    pub appealed: bool,
    pub is_cancel: bool,
    pub by_merchant: bool,
    pub state: RequestState,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct RequestView {
    pub amount: U128,
    pub reason_hash: String,
    pub summary_hash: Option<String>,
    pub opened_at: U64,
    pub decision_deadline: U64,
    pub veto_until: Option<U64>,
    pub appealed: bool,
    pub is_cancel: bool,
    pub by_merchant: bool,
    pub state: RequestState,
}

/// Stored receipt.
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Receipt {
    pub id: u64,
    pub merchant_id: AccountId,
    pub order_ref: String,
    pub amount: u128,
    pub released: u128,
    pub refunded: u128,
    /// USDC currently being transferred out for this receipt, awaiting its callback.
    pub in_flight: u128,
    pub kind: Kind,
    pub window_end: u64,
    pub created_at: u64,
    pub confirmed: bool,
    pub schedule: Vec<Tranche>,
    pub refund_target: RefundTarget,
    pub receipt_key: Option<[u8; 32]>,
    pub nonce: u32,
    pub transferable: bool,
    pub request: Option<Request>,
}

impl Receipt {
    /// Not yet released and not yet refunded.
    pub fn remaining(&self) -> u128 {
        self.amount - self.released - self.refunded
    }

    pub fn status(&self) -> Status {
        if self.refunded == self.amount {
            Status::Refunded
        } else if self.refunded > 0 {
            Status::PartiallyRefunded
        } else if self.released == self.amount {
            Status::Released
        } else if self.released > 0 {
            Status::PartiallyReleased
        } else {
            Status::Held
        }
    }

    pub fn has_active_request(&self) -> bool {
        self.request.as_ref().is_some_and(|q| q.state.is_active())
    }

    /// Sum of tranches in `state`.
    pub fn tranche_sum(&self, state: TrancheState) -> u128 {
        self.schedule
            .iter()
            .filter(|t| t.state == state)
            .map(|t| t.amount.0)
            .sum()
    }

    /// Flips every tranche in `from` to `to`.
    pub fn flip_tranches(&mut self, from: TrancheState, to: TrancheState) {
        for t in self.schedule.iter_mut().filter(|t| t.state == from) {
            t.state = to;
        }
    }
}

/// JSON shape returned by `get_receipt` and the list views.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct ReceiptView {
    pub id: u64,
    pub token_id: String,
    pub owner_id: AccountId,
    pub claimed: bool,
    pub transferable: bool,
    pub merchant_id: AccountId,
    pub order_ref: String,
    pub amount: U128,
    pub released: U128,
    pub refunded: U128,
    pub in_flight: U128,
    pub kind: Kind,
    pub status: Status,
    pub window_end: U64,
    pub created_at: U64,
    pub confirmed: bool,
    pub schedule: Vec<Tranche>,
    pub refund_target: RefundTarget,
    pub receipt_key: Option<String>,
    pub nonce: u32,
    pub request: Option<RequestView>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct ConfigView {
    pub usdc: AccountId,
    pub executor: AccountId,
    pub owner: AccountId,
    pub allocated: U128,
    pub in_flight_total: U128,
    pub mint_lock: bool,
    pub paused: bool,
    pub receipt_count: u64,
    pub receipt_storage_cost: U128,
}

/// Which kind of outgoing transfer a callback resolves.
#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TransferKind {
    Release,
    Refund,
}
