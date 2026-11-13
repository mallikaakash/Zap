//! Refund request state machine, holder actions and refund execution.
//!
//! ```text
//! None ─request_refund/cancel─► Open
//! Open ─ai_decide─► AiApproved ─(veto_secs pass, finalize_request)─► Approved
//!                   AiApproved ─veto─► Escalated
//! Open ─ai_decide─► Escalated ─approve/reject─► Approved | Rejected
//!                   Escalated ─(deadline, finalize_request)─► Approved
//! Open ─ai_decide─► AiDenied ─appeal (once)─► Escalated
//! Open ─approve/reject, or deadline─► Approved | Rejected
//! Approved ─execute_refund─► Executed   (failed transfer → back to Approved)
//! ```

use near_sdk::json_types::{U128, U64};
use near_sdk::{env, near, require, AccountId, Promise};

use crate::*;

#[near]
impl Contract {
    /// OneTime receipts. NFT owner, or anyone relaying a receipt-key signature.
    pub fn request_refund(&mut self, id: u64, amount: U128, reason_hash: String, sig: Option<String>) {
        let mut r = self.receipt(id);
        require!(
            r.kind == Kind::OneTime,
            "use cancel for Subscription/Schedule receipts"
        );
        assert_hash("reason_hash", &reason_hash);
        self.authorize_holder(
            &mut r,
            "request_refund",
            &format!("{}|{}", amount.0, reason_hash),
            sig,
        );
        let now = env::block_timestamp();
        require!(now < r.window_end, "refund window is over");
        require!(!r.confirmed, "receipt was confirmed as received");
        assert_can_open_request(&r);
        require!(amount.0 > 0, "amount must be positive");
        require!(
            amount.0 <= r.remaining(),
            "amount exceeds refundable balance"
        );
        self.open_request(&mut r, amount.0, reason_hash, false);
        self.receipts.insert(id, r);
    }

    /// Subscription/Schedule receipts. Every tranche that is Pending and not yet due becomes
    /// the refund request; tranches already due stay with the merchant.
    pub fn cancel(&mut self, id: u64, reason_hash: String, sig: Option<String>) {
        let mut r = self.receipt(id);
        require!(
            r.kind != Kind::OneTime,
            "use request_refund for OneTime receipts"
        );
        assert_hash("reason_hash", &reason_hash);
        self.authorize_holder(&mut r, "cancel", &reason_hash, sig);
        assert_can_open_request(&r);
        let total = mark_future_tranches(&mut r);
        require!(total > 0, "nothing to cancel");
        receipt_event("cancelled", &r)
            .field("amount", &U128(total))
            .field("reason_hash", &reason_hash)
            .emit();
        self.open_request(&mut r, total, reason_hash, true);
        self.receipts.insert(id, r);
    }

    /// Executor only (the AI triage agent). The merchant must have `ai_triage` on.
    /// `decision` is "approve", "partial", "escalate" or "deny".
    pub fn ai_decide(&mut self, id: u64, decision: String, amount: U128, summary_hash: String) {
        self.assert_executor();
        let mut r = self.receipt(id);
        let m = self.merchant(&r.merchant_id);
        require!(m.ai_triage, "merchant has not enabled AI triage");
        assert_hash("summary_hash", &summary_hash);
        let now = env::block_timestamp();
        let q = request_in(&mut r, &[RequestState::Open]);
        q.summary_hash = Some(summary_hash.clone());
        match decision.as_str() {
            "approve" | "partial" => {
                require!(amount.0 > 0, "amount must be positive");
                require!(amount.0 <= q.amount, "amount exceeds the request");
                require!(
                    !q.is_cancel || amount.0 == q.amount,
                    "a cancel request cannot be approved partially"
                );
                if amount.0 > m.auto_approve_max || amount.0 > m.guard_threshold {
                    q.state = RequestState::Escalated;
                    q.decision_deadline = deadline(now, m.response_secs);
                } else {
                    q.state = RequestState::AiApproved;
                    q.amount = amount.0;
                    q.veto_until = Some(deadline(now, m.veto_secs));
                }
            }
            "escalate" => {
                q.state = RequestState::Escalated;
                q.decision_deadline = deadline(now, m.response_secs);
            }
            "deny" => q.state = RequestState::AiDenied,
            _ => env::panic_str("decision must be approve, partial, escalate or deny"),
        }
        let (state, amount) = (q.state, q.amount);
        if state == RequestState::AiDenied {
            r.flip_tranches(TrancheState::RefundPending, TrancheState::Pending);
        }
        receipt_event("ai_decided", &r)
            .field("decision", &decision)
            .field("state", &state)
            .field("amount", &U128(amount))
            .field("summary_hash", &summary_hash)
            .field("veto_until", &r.request.as_ref().and_then(|q| q.veto_until).map(U64))
            .field("decision_deadline", &r.request.as_ref().map(|q| U64(q.decision_deadline)))
            .emit();
        self.receipts.insert(id, r);
    }

    /// Merchant approver. Within the veto window: AiApproved -> Escalated.
    pub fn veto(&mut self, id: u64, note: String) {
        let mut r = self.receipt(id);
        let m = self.assert_approver(&r);
        assert_note(&note);
        let now = env::block_timestamp();
        let q = request_in(&mut r, &[RequestState::AiApproved]);
        require!(
            q.veto_until.is_some_and(|until| now < until),
            "veto window is over"
        );
        q.state = RequestState::Escalated;
        q.veto_until = None;
        q.decision_deadline = deadline(now, m.response_secs);
        let (amount, until) = (q.amount, q.decision_deadline);
        receipt_event("vetoed", &r)
            .field("amount", &U128(amount))
            .field("note", &note)
            .field("decision_deadline", &U64(until))
            .emit();
        self.receipts.insert(id, r);
    }

    /// Holder. AiDenied -> Escalated, once.
    pub fn appeal(&mut self, id: u64, sig: Option<String>) {
        let mut r = self.receipt(id);
        self.authorize_holder(&mut r, "appeal", "", sig);
        let m = self.merchant(&r.merchant_id);
        let now = env::block_timestamp();
        require!(r.in_flight == 0, "transfer in flight");
        let remaining = r.remaining();
        let cancel_total = if r.request.as_ref().is_some_and(|q| q.is_cancel) {
            Some(mark_future_tranches(&mut r))
        } else {
            None
        };
        let q = request_in(&mut r, &[RequestState::AiDenied]);
        require!(!q.appealed, "already appealed");
        match cancel_total {
            Some(total) => {
                require!(total > 0, "funds were already released");
                q.amount = total;
            }
            None => require!(q.amount <= remaining, "funds were already released"),
        }
        q.appealed = true;
        q.state = RequestState::Escalated;
        q.decision_deadline = deadline(now, m.response_secs);
        let (amount, until) = (q.amount, q.decision_deadline);
        receipt_event("appealed", &r)
            .field("amount", &U128(amount))
            .field("decision_deadline", &U64(until))
            .emit();
        self.receipts.insert(id, r);
    }

    /// Merchant approver. Open or Escalated -> Approved.
    pub fn approve_refund(&mut self, id: u64) {
        let mut r = self.receipt(id);
        self.assert_approver(&r);
        let q = request_in(&mut r, &[RequestState::Open, RequestState::Escalated]);
        q.state = RequestState::Approved;
        let amount = q.amount;
        emit_approved(&r, amount, false);
        self.receipts.insert(id, r);
    }

    /// Merchant approver. Open or Escalated -> Rejected (final).
    pub fn reject_refund(&mut self, id: u64, note: String) {
        let mut r = self.receipt(id);
        self.assert_approver(&r);
        assert_note(&note);
        let q = request_in(&mut r, &[RequestState::Open, RequestState::Escalated]);
        q.state = RequestState::Rejected;
        let amount = q.amount;
        r.flip_tranches(TrancheState::RefundPending, TrancheState::Pending);
        receipt_event("refund_rejected", &r)
            .field("amount", &U128(amount))
            .field("note", &note)
            .emit();
        self.receipts.insert(id, r);
    }

    /// Anyone. AiApproved after the veto window, or Open/Escalated after the merchant's
    /// decision deadline (silence = approval) -> Approved.
    pub fn finalize_request(&mut self, id: u64) {
        let mut r = self.receipt(id);
        let now = env::block_timestamp();
        let q = request_in(
            &mut r,
            &[
                RequestState::AiApproved,
                RequestState::Open,
                RequestState::Escalated,
            ],
        );
        let from = q.state;
        match from {
            RequestState::AiApproved => require!(
                q.veto_until.is_some_and(|until| now >= until),
                "veto window still open"
            ),
            _ => require!(now >= q.decision_deadline, "decision deadline not reached"),
        }
        q.state = RequestState::Approved;
        let amount = q.amount;
        receipt_event("request_finalized", &r)
            .field("amount", &U128(amount))
            .field("from_state", &from)
            .field("state", &RequestState::Approved)
            .field("refund_target", &r.refund_target)
            .emit();
        self.receipts.insert(id, r);
    }

    /// Merchant approver. Refund unreleased funds without a customer request.
    /// Schedules: `amount` must equal the sum of all Pending tranches.
    pub fn merchant_refund(&mut self, id: u64, amount: U128) {
        let mut r = self.receipt(id);
        let m = self.assert_approver(&r);
        require!(!r.has_active_request(), "refund request active");
        require!(r.in_flight == 0, "transfer in flight");
        require!(amount.0 > 0, "amount must be positive");
        require!(amount.0 <= r.remaining(), "amount exceeds unreleased funds");
        let is_cancel = r.kind != Kind::OneTime;
        if is_cancel {
            require!(
                amount.0 == r.tranche_sum(TrancheState::Pending),
                "amount must equal the sum of all Pending tranches"
            );
            r.flip_tranches(TrancheState::Pending, TrancheState::RefundPending);
        }
        let now = env::block_timestamp();
        r.request = Some(Request {
            amount: amount.0,
            reason_hash: String::new(),
            summary_hash: None,
            opened_at: now,
            decision_deadline: deadline(now, m.response_secs),
            veto_until: None,
            appealed: false,
            is_cancel,
            by_merchant: true,
            state: RequestState::Approved,
        });
        emit_approved(&r, amount.0, true);
        self.receipts.insert(id, r);
    }

    /// Holder, OneTime receipts. Makes the funds releasable at once.
    pub fn confirm_received(&mut self, id: u64, sig: Option<String>) {
        let mut r = self.receipt(id);
        require!(r.kind == Kind::OneTime, "only OneTime receipts can be confirmed");
        self.authorize_holder(&mut r, "confirm_received", "", sig);
        require!(!r.has_active_request(), "refund request active");
        r.confirmed = true;
        receipt_event("confirmed", &r)
            .field("amount", &U128(r.remaining()))
            .emit();
        self.receipts.insert(id, r);
    }

    /// Executor only. Sends an Approved refund to `deposit_account`. Works while paused.
    /// Resolves to `true` if the USDC transfer succeeded, `false` if it failed and was rolled back.
    pub fn execute_refund(
        &mut self,
        id: u64,
        deposit_account: AccountId,
        amount: U128,
        quote_id: String,
    ) -> Promise {
        self.assert_executor();
        let mut r = self.receipt(id);
        require!(r.in_flight == 0, "transfer in flight");
        require!(quote_id.len() <= 128, "quote_id is too long");
        let remaining = r.remaining();
        let q = request_in(&mut r, &[RequestState::Approved]);
        require!(amount.0 == q.amount, "amount must equal the request amount");
        require!(amount.0 <= remaining, "amount exceeds unreleased funds");
        q.state = RequestState::Executed;
        let amount = amount.0;

        let mut m = self.merchant(&r.merchant_id);
        let today = env::block_timestamp() / NS_PER_DAY;
        if m.refund_day != today {
            m.refund_day = today;
            m.refunded_today = 0;
        }
        require!(
            m.refunded_today + amount <= m.daily_refund_cap,
            "daily refund cap exceeded"
        );
        m.refunded_today += amount;
        self.merchants.insert(r.merchant_id.clone(), m);

        let mut tranches = vec![];
        for (i, t) in r.schedule.iter_mut().enumerate() {
            if t.state == TrancheState::RefundPending {
                t.state = TrancheState::Refunded;
                tranches.push(i as u32);
            }
        }
        r.refunded += amount;
        r.in_flight = amount;
        self.allocated -= amount;
        self.in_flight_total += amount;
        self.receipts.insert(id, r);
        self.send_usdc(
            id,
            TransferKind::Refund,
            amount,
            tranches,
            deposit_account,
            Some(quote_id),
        )
    }

    /// Anyone relaying a receipt-key signature that binds `account`. Moves the receipt NFT
    /// from the contract to `account` and clears the receipt key.
    pub fn claim(&mut self, id: u64, account: AccountId, sig: String) {
        let mut r = self.receipt(id);
        let this = env::current_account_id();
        require!(self.owner_of(id) == this, "receipt already claimed");
        require!(account != this, "cannot claim to the contract account");
        verify_sig(&mut r, "claim", account.as_str(), Some(sig));
        r.receipt_key = None;
        self.tokens
            .internal_transfer(&this, &account, &id.to_string(), None, Some("claim".into()));
        receipt_event("claimed", &r)
            .field("amount", &U128(r.amount))
            .field("owner_id", &account)
            .emit();
        self.receipts.insert(id, r);
    }

    /// NFT owner, or anyone relaying a receipt-key signature that binds the new target.
    pub fn set_refund_target(&mut self, id: u64, target: RefundTarget, sig: Option<String>) {
        let mut r = self.receipt(id);
        assert_target(&target);
        self.authorize_holder(
            &mut r,
            "set_refund_target",
            &format!("{}|{}|{}", target.chain, target.asset, target.address),
            sig,
        );
        require!(r.in_flight == 0, "transfer in flight");
        require!(
            r.request.as_ref().is_none_or(|q| q.state != RequestState::Approved),
            "a refund is approved and about to be executed"
        );
        r.refund_target = target;
        receipt_event("refund_target_changed", &r)
            .field("refund_target", &r.refund_target)
            .emit();
        self.receipts.insert(id, r);
    }
}

impl Contract {
    /// Records a new Open request and emits `refund_requested`.
    fn open_request(&self, r: &mut Receipt, amount: u128, reason_hash: String, is_cancel: bool) {
        let m = self.merchant(&r.merchant_id);
        let now = env::block_timestamp();
        let decision_deadline = deadline(now, m.response_secs);
        receipt_event("refund_requested", r)
            .field("amount", &U128(amount))
            .field("reason_hash", &reason_hash)
            .field("is_cancel", &is_cancel)
            .field("ai_triage", &m.ai_triage)
            .field("decision_deadline", &U64(decision_deadline))
            .field("refund_target", &r.refund_target)
            .emit();
        r.request = Some(Request {
            amount,
            reason_hash,
            summary_hash: None,
            opened_at: now,
            decision_deadline,
            veto_until: None,
            appealed: false,
            is_cancel,
            by_merchant: false,
            state: RequestState::Open,
        });
    }
}

fn deadline(now: u64, secs: u64) -> u64 {
    now.saturating_add(secs.saturating_mul(NS_PER_SEC))
}

/// A new request is allowed when there is none, or the previous one was executed.
fn assert_can_open_request(r: &Receipt) {
    require!(r.in_flight == 0, "transfer in flight");
    require!(
        r.request.as_ref().is_none_or(|q| q.state == RequestState::Executed),
        "a refund request already exists"
    );
}

/// The receipt's request, which must be in one of `states`.
fn request_in<'a>(r: &'a mut Receipt, states: &[RequestState]) -> &'a mut Request {
    match r.request.as_mut() {
        Some(q) if states.contains(&q.state) => q,
        // "request is Open, expected [Approved]" (built by hand to keep Debug formatting out)
        Some(q) => {
            let expected: Vec<&str> = states.iter().map(|s| s.name()).collect();
            env::panic_str(&format!(
                "request is {}, expected [{}]",
                q.state.name(),
                expected.join(", ")
            ))
        }
        None => env::panic_str("no refund request"),
    }
}

/// Pending tranches that are not yet due become RefundPending. Returns their sum.
fn mark_future_tranches(r: &mut Receipt) -> u128 {
    let now = env::block_timestamp();
    let mut total = 0u128;
    for t in r.schedule.iter_mut() {
        if t.state == TrancheState::Pending && t.at.0 > now {
            t.state = TrancheState::RefundPending;
            total += t.amount.0;
        }
    }
    total
}

fn emit_approved(r: &Receipt, amount: u128, by_merchant: bool) {
    receipt_event("refund_approved", r)
        .field("amount", &U128(amount))
        .field("by_merchant", &by_merchant)
        .field("refund_target", &r.refund_target)
        .emit();
}
