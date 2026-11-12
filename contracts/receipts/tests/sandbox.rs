//! Sandbox integration tests: both contracts are built with cargo-near, deployed to a local
//! near-sandbox node and driven through real transactions and cross-contract calls.
//!
//! No real network, key or money is involved. Every account uses the sandbox genesis key.

use std::sync::{Arc, OnceLock};

use near_api::{AccountId, Contract, NearGas, NearToken, NetworkConfig, Signer};
use ed25519_dalek::{Signer as _, SigningKey};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

type TestResult = Result<(), Box<dyn std::error::Error>>;

const USDC: u128 = 1_000_000;
const SEC: u64 = 1_000_000_000;
// Test merchant `shop`. Sandbox fast-forward moves the chain clock by about 0.3 s per block,
// so 120 s is ~400 blocks.
const GUARD: u128 = 50 * USDC;
const AUTO_APPROVE_MAX: u128 = 20 * USDC;
const DAILY_CAP: u128 = 500 * USDC;
const WINDOW_SECS: u64 = 120;
const RESPONSE_SECS: u64 = 120;
const VETO_SECS: u64 = 60;

// ------------------------------------------------------------------ harness

/// Builds both contracts once per test binary and returns (receipts, mock_usdc) wasm bytes.
fn wasm() -> &'static (Vec<u8>, Vec<u8>) {
    static WASM: OnceLock<(Vec<u8>, Vec<u8>)> = OnceLock::new();
    WASM.get_or_init(|| {
        let build = |manifest: &str| {
            let manifest = format!("{}/{manifest}", env!("CARGO_MANIFEST_DIR"));
            let opts = cargo_near_build::BuildOpts {
                manifest_path: Some(manifest.into()),
                ..Default::default()
            };
            let path = cargo_near_build::build_with_cli(opts).expect("cargo near build failed");
            std::fs::read(path).expect("wasm not found")
        };
        (build("Cargo.toml"), build("../mock-usdc/Cargo.toml"))
    })
}

struct Outcome {
    ok: bool,
    value: Option<Value>,
    error: String,
    logs: Vec<String>,
}

impl Outcome {
    #[track_caller]
    fn success(self) -> Self {
        assert!(self.ok, "expected success, got: {}", self.error);
        self
    }

    #[track_caller]
    fn fails_with(self, msg: &str) {
        assert!(!self.ok, "expected failure containing {msg:?}, but the call succeeded");
        assert!(
            self.error.contains(msg),
            "expected failure containing {msg:?}, got: {}",
            self.error
        );
    }

    /// The JSON return value of a successful call.
    #[track_caller]
    fn json(self) -> Value {
        self.success().value.expect("no return value")
    }

    /// Data objects of all `universal_checkout` events with this name.
    fn events(&self, name: &str) -> Vec<Value> {
        self.logs
            .iter()
            .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
            .filter_map(|l| serde_json::from_str::<Value>(l).ok())
            .filter(|e| e["standard"] == "universal_checkout" && e["event"] == name)
            .map(|e| {
                assert_eq!(e["version"], "1.0.0");
                e["data"][0].clone()
            })
            .collect()
    }

    #[track_caller]
    fn event(&self, name: &str) -> Value {
        let mut found = self.events(name);
        assert_eq!(found.len(), 1, "expected one {name} event in {:?}", self.logs);
        found.remove(0)
    }
}

struct Env {
    sandbox: near_sandbox::Sandbox,
    net: NetworkConfig,
    signer: Arc<Signer>,
}

fn id(name: &str) -> AccountId {
    format!("{name}.sandbox").parse().unwrap()
}

impl Env {
    /// Starts a sandbox with both contracts deployed, a registered merchant `shop` (payout
    /// `payout`, approver `approver`) and plain accounts for everyone else.
    /// `payout` and `sink` are NOT registered with the USDC contract.
    async fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let (receipts_wasm, usdc_wasm) = tokio::task::spawn_blocking(wasm).await?.clone();
        let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
        let net = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
        let signer = Signer::from_secret_key(
            near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
        )?;
        let env = Self { sandbox, net, signer };

        for name in [
            "usdc", "receipts", "owner", "executor", "shop", "plain", "payout", "approver", "alice",
            "bob", "relayer", "sink",
        ] {
            env.sandbox
                .create_account(id(name))
                .initial_balance(NearToken::from_near(20))
                .send()
                .await?;
        }

        Contract::deploy(id("usdc"))
            .use_code(usdc_wasm)
            .with_init_call("new", json!({}))?
            .with_signer(env.signer.clone())
            .send_to(&env.net)
            .await?
            .assert_success();
        Contract::deploy(id("receipts"))
            .use_code(receipts_wasm)
            .with_init_call(
                "new",
                json!({"usdc": id("usdc"), "executor": id("executor"), "owner": id("owner")}),
            )?
            .with_signer(env.signer.clone())
            .send_to(&env.net)
            .await?
            .assert_success();

        env.register_merchant("shop", true, DAILY_CAP).await;
        Ok(env)
    }

    async fn call_with(
        &self,
        signer: &str,
        contract: &str,
        method: &str,
        args: Value,
        deposit: NearToken,
    ) -> Outcome {
        let result = Contract(id(contract))
            .call_function(method, args)
            .transaction()
            .gas(NearGas::from_tgas(100))
            .deposit(deposit)
            .with_signer(id(signer), self.signer.clone())
            .send_to(&self.net)
            .await
            .expect("rpc error")
            .into_full()
            .expect("transaction still pending");
        let logs = result.logs().iter().map(|l| l.to_string()).collect();
        match result.into_result() {
            Ok(success) => Outcome {
                ok: true,
                value: success.json::<Value>().ok(),
                error: String::new(),
                logs,
            },
            Err(failure) => Outcome {
                ok: false,
                value: None,
                error: format!("{failure:?}"),
                logs,
            },
        }
    }

    /// Registers (or updates) a merchant with payout `payout`, approver `approver` and 1 NEAR
    /// of prepaid storage.
    async fn register_merchant(&self, merchant: &str, ai_triage: bool, daily_cap: u128) {
        self.call_with(
            merchant,
            "receipts",
            "register_merchant",
            json!({
                "payout": id("payout"),
                "approver": id("approver"),
                "guard_threshold": GUARD.to_string(),
                "default_window_secs": WINDOW_SECS,
                "response_secs": RESPONSE_SECS,
                "daily_refund_cap": daily_cap.to_string(),
                "ai_triage": ai_triage,
                "auto_approve_max": AUTO_APPROVE_MAX.to_string(),
                "veto_secs": VETO_SECS,
            }),
            NearToken::from_near(1),
        )
        .await
        .success();
    }

    async fn call(&self, signer: &str, contract: &str, method: &str, args: Value) -> Outcome {
        self.call_with(signer, contract, method, args, NearToken::from_yoctonear(0))
            .await
    }

    async fn view(&self, contract: &str, method: &str, args: Value) -> Value {
        Contract(id(contract))
            .call_function(method, args)
            .read_only::<Value>()
            .fetch_from(&self.net)
            .await
            .expect("view failed")
            .data
    }

    async fn now(&self) -> u64 {
        near_api::Chain::block()
            .fetch_from(&self.net)
            .await
            .expect("block")
            .header
            .timestamp_nanosec
            .parse()
            .unwrap()
    }

    /// Fast-forwards the sandbox until the chain clock is past `ts` (ns).
    async fn advance_past(&self, ts: u64) {
        while self.now().await <= ts {
            self.sandbox.fast_forward(100).await.expect("fast_forward");
        }
    }

    /// Faucet-mints USDC straight to an account (this is how the mock adapter "delivers" funds).
    async fn fund(&self, account: &str, amount: u128) {
        self.call(
            "relayer",
            "usdc",
            "mint",
            json!({"account_id": id(account), "amount": amount.to_string()}),
        )
        .await
        .success();
    }

    /// NEP-145 registration of `account` with the USDC contract.
    async fn register_usdc(&self, account: &str) {
        self.call_with(
            "relayer",
            "usdc",
            "storage_deposit",
            json!({"account_id": id(account), "registration_only": true}),
            NearToken::from_millinear(10),
        )
        .await
        .success();
    }

    async fn usdc_balance(&self, account: &str) -> u128 {
        as_u128(
            &self
                .view("usdc", "ft_balance_of", json!({"account_id": id(account)}))
                .await,
        )
    }

    async fn receipt(&self, receipt_id: u64) -> Value {
        self.view("receipts", "get_receipt", json!({"id": receipt_id}))
            .await
    }

    async fn config(&self) -> Value {
        self.view("receipts", "get_config", json!({})).await
    }

    /// Executor path: `mint_receipt` against USDC already sitting in the contract.
    async fn mint(&self, args: Value) -> Outcome {
        self.call("executor", "receipts", "mint_receipt", json!({"args": args}))
            .await
    }

    /// Direct path: `payer` sends USDC with `ft_transfer_call` and `msg`.
    async fn pay(&self, payer: &str, amount: u128, msg: Value) -> Outcome {
        self.call_with(
            payer,
            "usdc",
            "ft_transfer_call",
            json!({
                "receiver_id": id("receipts"),
                "amount": amount.to_string(),
                "msg": msg.to_string(),
            }),
            NearToken::from_yoctonear(1),
        )
        .await
    }

    /// Funds `alice` from the faucet, pays directly and returns the new receipt id.
    async fn paid(&self, amount: u128, msg: Value) -> u64 {
        self.fund("alice", amount).await;
        let out = self.pay("alice", amount, msg).await.success();
        out.event("receipt_minted")["receipt_id"].as_u64().unwrap()
    }

    /// A holder action relayed by `relayer` with a receipt-key signature.
    async fn signed(&self, receipt_id: u64, action: &str, params: &str, mut args: Value) -> Outcome {
        let nonce = self.receipt(receipt_id).await["nonce"].as_u64().unwrap() as u32;
        args["id"] = json!(receipt_id);
        args["sig"] = json!(sign(receipt_id, action, params, nonce));
        self.call("relayer", "receipts", action, args).await
    }

    async fn request_refund(&self, receipt_id: u64, amount: u128) -> Outcome {
        self.signed(
            receipt_id,
            "request_refund",
            &format!("{amount}|{REASON}"),
            json!({"amount": amount.to_string(), "reason_hash": REASON}),
        )
        .await
    }

    async fn execute(&self, receipt_id: u64, amount: u128) -> Outcome {
        self.call(
            "executor",
            "receipts",
            "execute_refund",
            json!({
                "id": receipt_id,
                "deposit_account": id("sink"),
                "amount": amount.to_string(),
                "quote_id": "quote-42",
            }),
        )
        .await
    }

    async fn request_state(&self, receipt_id: u64) -> String {
        self.receipt(receipt_id).await["request"]["state"]
            .as_str()
            .expect("no request")
            .to_string()
    }
}


fn as_u128(v: &Value) -> u128 {
    v.as_str()
        .unwrap_or_else(|| panic!("expected a string amount, got {v}"))
        .parse()
        .unwrap()
}

fn as_u64(v: &Value) -> u64 {
    v.as_str()
        .unwrap_or_else(|| panic!("expected a string u64, got {v}"))
        .parse()
        .unwrap()
}

const REASON: &str = "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8";
const SUMMARY: &str = "0123456789abcdef";

fn signing_key() -> SigningKey {
    SigningKey::from_bytes(&[9u8; 32])
}

fn receipt_key() -> String {
    hex::encode(signing_key().verifying_key().as_bytes())
}

/// Receipt-key signature exactly as documented in INTERFACE.md:
/// ed25519 over sha256("uc:v1|{contract_id}|{receipt_id}|{action}|{params}|{nonce}").
fn sign(receipt_id: u64, action: &str, params: &str, nonce: u32) -> String {
    let preimage = format!(
        "uc:v1|{}|{receipt_id}|{action}|{params}|{nonce}",
        id("receipts")
    );
    let digest = Sha256::digest(preimage.as_bytes());
    hex::encode(signing_key().sign(&digest).to_bytes())
}

fn refund_target() -> Value {
    json!({"chain": "polygon", "asset": "usdt", "address": "0x00000000000000000000000000000000000000aa"})
}

/// MintArgs without `amount` (the `ft_on_transfer` message shape).
fn one_time(order_ref: &str) -> Value {
    json!({
        "merchant_id": id("shop"),
        "order_ref": order_ref,
        "kind": "OneTime",
        "refund_target": refund_target(),
        "receipt_key": receipt_key(),
    })
}

fn with(mut v: Value, key: &str, value: Value) -> Value {
    v[key] = value;
    v
}

/// MintArgs for `mint_receipt`.
fn mint_args(order_ref: &str, amount: u128) -> Value {
    with(one_time(order_ref), "amount", json!(amount.to_string()))
}

fn schedule(order_ref: &str, kind: &str, tranches: &[(u64, u128)]) -> Value {
    let mut v = one_time(order_ref);
    v["kind"] = json!(kind);
    v["schedule"] = tranches
        .iter()
        .map(|(at, amount)| json!({"at": at.to_string(), "amount": amount.to_string()}))
        .collect();
    v
}

fn tranche_states(receipt: &Value) -> Vec<String> {
    receipt["schedule"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["state"].as_str().unwrap().to_string())
        .collect()
}

// -------------------------------------------------------------------- tests

#[tokio::test]
async fn mock_usdc_is_a_working_faucet_token() -> TestResult {
    let env = Env::new().await?;

    let meta = env.view("usdc", "ft_metadata", json!({})).await;
    assert_eq!(meta["decimals"], 6);
    assert_eq!(meta["symbol"], "USDC");
    assert_eq!(meta["name"], "Mock USDC");

    // mint auto-registers
    env.fund("alice", 25 * USDC).await;
    assert_eq!(env.usdc_balance("alice").await, 25 * USDC);
    assert_eq!(as_u128(&env.view("usdc", "ft_total_supply", json!({})).await), 25 * USDC);

    // transfer to an unregistered account fails, storage_deposit fixes it
    let transfer = json!({"receiver_id": id("bob"), "amount": (5 * USDC).to_string()});
    env.call_with("alice", "usdc", "ft_transfer", transfer.clone(), NearToken::from_yoctonear(1))
        .await
        .fails_with("is not registered");
    assert!(env
        .view("usdc", "storage_balance_of", json!({"account_id": id("bob")}))
        .await
        .is_null());
    env.register_usdc("bob").await;
    env.call_with("alice", "usdc", "ft_transfer", transfer, NearToken::from_yoctonear(1))
        .await
        .success();
    assert_eq!(env.usdc_balance("bob").await, 5 * USDC);
    assert_eq!(env.usdc_balance("alice").await, 20 * USDC);
    Ok(())
}

#[tokio::test]
async fn mint_receipt_is_gated_on_unassigned_balance() -> TestResult {
    let env = Env::new().await?;

    // executor only
    env.call("shop", "receipts", "mint_receipt", json!({"args": mint_args("order-1", 10 * USDC)}))
        .await
        .fails_with("executor only");

    // no USDC delivered yet: the transaction fails and the mint lock is free again
    env.mint(mint_args("order-1", 10 * USDC))
        .await
        .fails_with("insufficient unassigned USDC");
    let cfg = env.config().await;
    assert_eq!(cfg["receipt_count"], 0);
    assert_eq!(cfg["mint_lock"], false);

    // unknown merchant, and a merchant without prepaid storage
    env.mint(with(mint_args("order-1", USDC), "merchant_id", json!(id("bob"))))
        .await
        .fails_with("merchant not registered");
    env.call(
        "plain",
        "receipts",
        "register_merchant",
        json!({
            "payout": id("payout"), "approver": id("approver"), "guard_threshold": "0",
            "default_window_secs": 0, "response_secs": 0, "daily_refund_cap": "0",
            "ai_triage": false, "auto_approve_max": "0", "veto_secs": 0,
        }),
    )
    .await
    .success();
    env.mint(with(mint_args("order-1", USDC), "merchant_id", json!(id("plain"))))
        .await
        .fails_with("merchant storage balance too low");

    // 1Click-style delivery: USDC lands in the contract with no message, then the executor mints
    env.fund("receipts", 10 * USDC).await;
    env.mint(mint_args("order-1", 10 * USDC + 1))
        .await
        .fails_with("insufficient unassigned USDC");
    let out = env.mint(mint_args("order-1", 10 * USDC)).await.success();
    let minted = out.event("receipt_minted");
    assert_eq!(minted["receipt_id"], 1);
    assert_eq!(minted["merchant_id"], json!(id("shop")));
    assert_eq!(minted["order_ref"], "order-1");
    assert_eq!(as_u128(&minted["amount"]), 10 * USDC);
    assert_eq!(out.value, Some(json!(1)));

    // the same deposit cannot back a second receipt
    env.mint(mint_args("order-2", 10 * USDC))
        .await
        .fails_with("insufficient unassigned USDC");
    env.mint(mint_args("order-2", 1))
        .await
        .fails_with("insufficient unassigned USDC");

    // order_ref is unique across the contract, even for another merchant with fresh funds
    env.fund("receipts", 7 * USDC).await;
    env.mint(mint_args("order-1", 7 * USDC))
        .await
        .fails_with("order_ref already used");
    env.call_with("bob", "receipts", "fund_storage", json!({"merchant_id": id("plain")}), NearToken::from_millinear(50))
        .await
        .success();
    env.mint(with(mint_args("order-1", 7 * USDC), "merchant_id", json!(id("plain"))))
        .await
        .fails_with("order_ref already used");
    let id2 = env.mint(mint_args("order-2", 7 * USDC)).await.json();
    assert_eq!(id2, 2);

    let cfg = env.config().await;
    assert_eq!(as_u128(&cfg["allocated"]), 17 * USDC);
    assert_eq!(as_u128(&cfg["in_flight_total"]), 0);
    assert_eq!(cfg["receipt_count"], 2);
    assert_eq!(cfg["mint_lock"], false);
    assert_eq!(cfg["paused"], false);
    assert_eq!(cfg["usdc"], json!(id("usdc")));
    assert_eq!(cfg["executor"], json!(id("executor")));
    assert_eq!(cfg["receipt_storage_cost"], "10000000000000000000000");

    // receipt shape
    let r = env.receipt(1).await;
    assert_eq!(r["id"], 1);
    assert_eq!(r["token_id"], "1");
    assert_eq!(r["owner_id"], json!(id("receipts")));
    assert_eq!(r["claimed"], false);
    assert_eq!(r["transferable"], false);
    assert_eq!(r["confirmed"], false);
    assert_eq!(r["kind"], "OneTime");
    assert_eq!(r["status"], "Held");
    assert_eq!(as_u128(&r["amount"]), 10 * USDC);
    assert_eq!(as_u128(&r["in_flight"]), 0);
    assert_eq!(r["receipt_key"], receipt_key().as_str());
    assert_eq!(r["nonce"], 0);
    assert!(r["request"].is_null());
    assert_eq!(r["refund_target"], refund_target());
    assert_eq!(
        as_u64(&r["window_end"]) - as_u64(&r["created_at"]),
        WINDOW_SECS * SEC
    );
    assert!(env.receipt(3).await.is_null());

    // list views and NEP-171/177/181 views
    let list = env
        .view(
            "receipts",
            "receipts_for_merchant",
            json!({"merchant_id": id("shop"), "from_index": 1, "limit": 10}),
        )
        .await;
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["id"], 2);
    let by_ref = env
        .view("receipts", "get_receipt_by_order_ref", json!({"order_ref": "order-2"}))
        .await;
    assert_eq!(by_ref["id"], 2);
    let token = env.view("receipts", "nft_token", json!({"token_id": "1"})).await;
    assert_eq!(token["owner_id"], json!(id("receipts")));
    assert_eq!(token["metadata"]["title"], "Receipt #1");
    assert_eq!(env.view("receipts", "nft_total_supply", json!({})).await, "2");
    assert_eq!(
        env.view("receipts", "nft_metadata", json!({})).await["spec"],
        "nft-1.0.0"
    );
    let merchant = env.view("receipts", "get_merchant", json!({"id": id("shop")})).await;
    assert_eq!(merchant["payout"], json!(id("payout")));
    assert_eq!(merchant["receipt_count"], 2);
    assert_eq!(merchant["ai_triage"], true);
    assert_eq!(merchant["veto_secs"], VETO_SECS);
    assert_eq!(merchant["storage_balance"], "980000000000000000000000");
    assert_eq!(merchant["refunded_today"], "0");
    Ok(())
}

#[tokio::test]
async fn direct_payment_top_up_and_pause() -> TestResult {
    let env = Env::new().await?;
    env.register_usdc("payout").await;
    env.register_usdc("sink").await;
    env.fund("alice", 100 * USDC).await;

    // direct USDC payment: ft_transfer_call with the mint message, no refund_target given
    let mut msg = one_time("order-1");
    msg.as_object_mut().unwrap().remove("refund_target");
    let out = env.pay("alice", 10 * USDC, msg).await.success();
    assert_eq!(out.event("receipt_minted")["receipt_id"], 1);
    assert_eq!(out.value, Some(json!((10 * USDC).to_string())), "ft_transfer_call returns the used amount");
    assert_eq!(env.usdc_balance("alice").await, 90 * USDC);
    assert_eq!(env.usdc_balance("receipts").await, 10 * USDC);
    let r = env.receipt(1).await;
    assert_eq!(as_u128(&r["amount"]), 10 * USDC);
    assert_eq!(
        r["refund_target"],
        json!({"chain": "near", "asset": id("usdc"), "address": id("alice")})
    );
    assert_eq!(as_u128(&env.config().await["allocated"]), 10 * USDC);

    // rejected payments come back in full: duplicate order_ref, unknown merchant, bad msg
    for (msg, reason) in [
        (one_time("order-1").to_string(), "order_ref already used"),
        (
            with(one_time("order-2"), "merchant_id", json!(id("bob"))).to_string(),
            "merchant not registered",
        ),
        ("pay me".to_string(), "msg is not valid JSON"),
    ] {
        let out = env
            .call_with(
                "alice",
                "usdc",
                "ft_transfer_call",
                json!({"receiver_id": id("receipts"), "amount": (5 * USDC).to_string(), "msg": msg}),
                NearToken::from_yoctonear(1),
            )
            .await
            .success();
        assert_eq!(out.value, Some(json!("0")), "nothing was used");
        assert_eq!(out.event("payment_rejected")["reason"], reason);
        assert_eq!(env.usdc_balance("alice").await, 90 * USDC);
        assert_eq!(env.usdc_balance("receipts").await, 10 * USDC);
    }
    let cfg = env.config().await;
    assert_eq!(as_u128(&cfg["allocated"]), 10 * USDC);
    assert_eq!(cfg["receipt_count"], 1);

    // a pass with two tranches, then a renewal top-up
    let now = env.now().await;
    let pass = schedule("pass-1", "Subscription", &[(now, 10 * USDC), (now + 1000 * SEC, 10 * USDC)]);
    let out = env.pay("alice", 20 * USDC, pass).await.success();
    assert_eq!(out.event("receipt_minted")["receipt_id"], 2);
    let out = env.pay("alice", 10 * USDC, json!({"topup_of": 2})).await.success();
    let ev = out.event("topped_up");
    assert_eq!(ev["receipt_id"], 2);
    assert_eq!(as_u128(&ev["amount"]), 10 * USDC);
    let r = env.receipt(2).await;
    assert_eq!(r["transferable"], true);
    assert_eq!(as_u128(&r["amount"]), 30 * USDC);
    assert_eq!(r["schedule"].as_array().unwrap().len(), 3);
    assert_eq!(as_u64(&r["schedule"][2]["at"]), now + 1000 * SEC);
    assert_eq!(as_u128(&env.config().await["allocated"]), 40 * USDC);
    // one-time receipts cannot be topped up
    let out = env.pay("alice", USDC, json!({"topup_of": 1})).await.success();
    assert_eq!(
        out.event("payment_rejected")["reason"],
        "top-up is for Subscription/Schedule receipts"
    );
    assert_eq!(env.usdc_balance("alice").await, 60 * USDC);

    // pause: owner only; blocks both mint paths and release, but not refunds
    env.call("executor", "receipts", "pause", json!({})).await.fails_with("owner only");
    env.call("approver", "receipts", "merchant_refund", json!({"id": 1, "amount": (4 * USDC).to_string()}))
        .await
        .success();
    env.call("owner", "receipts", "pause", json!({})).await.success();
    assert_eq!(env.config().await["paused"], true);

    let out = env.pay("alice", 5 * USDC, one_time("order-3")).await.success();
    assert_eq!(out.event("payment_rejected")["reason"], "contract is paused");
    assert_eq!(env.usdc_balance("alice").await, 60 * USDC);
    env.fund("receipts", 5 * USDC).await;
    env.mint(mint_args("order-3", 5 * USDC)).await.fails_with("contract is paused");
    env.call("bob", "receipts", "release", json!({"id": 2}))
        .await
        .fails_with("contract is paused");

    let out = env.execute(1, 4 * USDC).await.success();
    assert_eq!(out.value, Some(json!(true)));
    assert_eq!(env.usdc_balance("sink").await, 4 * USDC);
    // customers can still open requests while paused
    env.signed(2, "cancel", REASON, json!({"reason_hash": REASON})).await.success();
    env.call("approver", "receipts", "reject_refund", json!({"id": 2, "note": "test"}))
        .await
        .success();

    env.call("owner", "receipts", "unpause", json!({})).await.success();
    assert_eq!(
        env.call("bob", "receipts", "release", json!({"id": 2})).await.json(),
        true
    );
    assert_eq!(env.usdc_balance("payout").await, 10 * USDC);
    assert_eq!(env.mint(mint_args("order-3", 5 * USDC)).await.json(), 3);
    Ok(())
}

#[tokio::test]
async fn release_after_window_confirm_and_rollback() -> TestResult {
    let env = Env::new().await?;
    let id1 = env.paid(10 * USDC, one_time("order-1")).await;

    env.call("bob", "receipts", "release", json!({"id": id1}))
        .await
        .fails_with("refund window still open");

    let window_end = as_u64(&env.receipt(id1).await["window_end"]);
    env.advance_past(window_end).await;

    // payout is not registered with USDC: the transfer fails and everything is restored
    let out = env.call("bob", "receipts", "release", json!({"id": id1})).await.success();
    assert_eq!(out.value, Some(json!(false)));
    assert_eq!(out.event("transfer_failed")["action"], "release");
    assert!(out.events("released").is_empty());
    let r = env.receipt(id1).await;
    assert_eq!(r["status"], "Held");
    assert_eq!(as_u128(&r["released"]), 0);
    assert_eq!(as_u128(&r["in_flight"]), 0);
    let cfg = env.config().await;
    assert_eq!(as_u128(&cfg["allocated"]), 10 * USDC);
    assert_eq!(as_u128(&cfg["in_flight_total"]), 0);
    assert_eq!(env.usdc_balance("receipts").await, 10 * USDC);

    // the still-held funds cannot be assigned to a new receipt
    env.mint(mint_args("order-2", USDC))
        .await
        .fails_with("insufficient unassigned USDC");
    // and the window is over for refund requests
    env.request_refund(id1, USDC).await.fails_with("refund window is over");

    // once the payout account is registered, anyone can release
    env.register_usdc("payout").await;
    let out = env.call("bob", "receipts", "release", json!({"id": id1})).await.success();
    assert_eq!(out.value, Some(json!(true)));
    let released = out.event("released");
    assert_eq!(released["receipt_id"], id1);
    assert_eq!(as_u128(&released["amount"]), 10 * USDC);
    assert_eq!(released["status"], "Released");
    assert_eq!(env.usdc_balance("payout").await, 10 * USDC);
    assert_eq!(env.usdc_balance("receipts").await, 0);
    let r = env.receipt(id1).await;
    assert_eq!(r["status"], "Released");
    assert_eq!(as_u128(&r["released"]), 10 * USDC);
    let cfg = env.config().await;
    assert_eq!(as_u128(&cfg["allocated"]), 0);
    assert_eq!(as_u128(&cfg["in_flight_total"]), 0);

    env.call("bob", "receipts", "release", json!({"id": id1}))
        .await
        .fails_with("nothing to release");
    env.call("approver", "receipts", "merchant_refund", json!({"id": id1, "amount": "1"}))
        .await
        .fails_with("amount exceeds unreleased funds");

    // confirm_received (signed by the receipt key, relayed) releases before the window ends
    let id2 = env.paid(6 * USDC, one_time("order-2")).await;
    env.call("bob", "receipts", "release", json!({"id": id2}))
        .await
        .fails_with("refund window still open");
    let out = env.signed(id2, "confirm_received", "", json!({})).await.success();
    assert_eq!(out.event("confirmed")["receipt_id"], id2);
    assert_eq!(env.receipt(id2).await["confirmed"], true);
    assert_eq!(
        env.call("bob", "receipts", "release", json!({"id": id2})).await.json(),
        true
    );
    assert_eq!(env.usdc_balance("payout").await, 16 * USDC);

    // a zero window is releasable right away
    let id3 = env.paid(3 * USDC, with(one_time("order-3"), "window_secs", json!(0))).await;
    assert_eq!(
        env.call("alice", "receipts", "release", json!({"id": id3})).await.json(),
        true
    );
    assert_eq!(env.usdc_balance("payout").await, 19 * USDC);
    assert_eq!(env.usdc_balance("receipts").await, 0);
    Ok(())
}

#[tokio::test]
async fn ai_approved_refund_veto_window_and_execute_rollback() -> TestResult {
    let env = Env::new().await?;
    let long = |order: &str| with(one_time(order), "window_secs", json!(100_000));
    let id1 = env.paid(30 * USDC, long("order-1")).await;

    // signed request relayed by a third party
    let out = env.request_refund(id1, 15 * USDC).await.success();
    let ev = out.event("refund_requested");
    assert_eq!(ev["receipt_id"], id1);
    assert_eq!(as_u128(&ev["amount"]), 15 * USDC);
    assert_eq!(ev["refund_target"], refund_target());
    let r = env.receipt(id1).await;
    assert_eq!(r["nonce"], 1);
    let q = &r["request"];
    assert_eq!(q["state"], "Open");
    assert_eq!(q["reason_hash"], REASON);
    assert_eq!(
        as_u64(&q["decision_deadline"]) - as_u64(&q["opened_at"]),
        RESPONSE_SECS * SEC
    );
    assert!(q["veto_until"].is_null());

    // one request at a time; release and execution are blocked while it is open
    env.request_refund(id1, USDC).await.fails_with("a refund request already exists");
    env.signed(id1, "confirm_received", "", json!({}))
        .await
        .fails_with("refund request active");
    env.execute(id1, 15 * USDC).await.fails_with("request is Open, expected [Approved]");

    // AI triage: executor only, partial approval of 12 USDC (<= auto_approve_max 20)
    let decide = |decision: &str, amount: u128| {
        json!({"id": id1, "decision": decision, "amount": amount.to_string(), "summary_hash": SUMMARY})
    };
    env.call("approver", "receipts", "ai_decide", decide("approve", 12 * USDC))
        .await
        .fails_with("executor only");
    env.call("executor", "receipts", "ai_decide", decide("approve", 16 * USDC))
        .await
        .fails_with("amount exceeds the request");
    let out = env
        .call("executor", "receipts", "ai_decide", decide("partial", 12 * USDC))
        .await
        .success();
    assert_eq!(out.event("ai_decided")["state"], "AiApproved");
    let q = env.receipt(id1).await["request"].clone();
    assert_eq!(q["state"], "AiApproved");
    assert_eq!(as_u128(&q["amount"]), 12 * USDC);
    assert_eq!(q["summary_hash"], SUMMARY);
    let veto_until = as_u64(&q["veto_until"]);

    // not executable during the veto window
    env.call("bob", "receipts", "finalize_request", json!({"id": id1}))
        .await
        .fails_with("veto window still open");
    env.execute(id1, 12 * USDC).await.fails_with("expected [Approved]");
    env.advance_past(veto_until).await;
    env.call("approver", "receipts", "veto", json!({"id": id1, "note": "too late"}))
        .await
        .fails_with("veto window is over");
    let out = env
        .call("bob", "receipts", "finalize_request", json!({"id": id1}))
        .await
        .success();
    assert_eq!(out.event("request_finalized")["from_state"], "AiApproved");
    assert_eq!(env.request_state(id1).await, "Approved");

    // execute_refund: executor only, exact amount
    env.call(
        "relayer",
        "receipts",
        "execute_refund",
        json!({"id": id1, "deposit_account": id("relayer"), "amount": (12 * USDC).to_string(), "quote_id": "q"}),
    )
    .await
    .fails_with("executor only");
    env.execute(id1, 11 * USDC).await.fails_with("amount must equal the request amount");

    // sink is not registered with USDC: rolled back to Approved
    let out = env.execute(id1, 12 * USDC).await.success();
    assert_eq!(out.value, Some(json!(false)));
    let failed = out.event("transfer_failed");
    assert_eq!(failed["action"], "refund");
    assert_eq!(failed["quote_id"], "quote-42");
    let r = env.receipt(id1).await;
    assert_eq!(r["status"], "Held");
    assert_eq!(r["request"]["state"], "Approved");
    assert_eq!(as_u128(&r["refunded"]), 0);
    assert_eq!(as_u128(&r["in_flight"]), 0);
    let cfg = env.config().await;
    assert_eq!(as_u128(&cfg["allocated"]), 30 * USDC);
    assert_eq!(as_u128(&cfg["in_flight_total"]), 0);
    assert_eq!(env.usdc_balance("receipts").await, 30 * USDC);
    let merchant = env.view("receipts", "get_merchant", json!({"id": id("shop")})).await;
    assert_eq!(merchant["refunded_today"], "0");

    env.register_usdc("sink").await;
    let out = env.execute(id1, 12 * USDC).await.success();
    assert_eq!(out.value, Some(json!(true)));
    let ev = out.event("refund_executed");
    assert_eq!(as_u128(&ev["amount"]), 12 * USDC);
    assert_eq!(ev["deposit_account"], json!(id("sink")));
    assert_eq!(ev["quote_id"], "quote-42");
    assert_eq!(ev["status"], "PartiallyRefunded");
    assert_eq!(env.usdc_balance("sink").await, 12 * USDC);
    let r = env.receipt(id1).await;
    assert_eq!(r["status"], "PartiallyRefunded");
    assert_eq!(r["request"]["state"], "Executed");
    assert_eq!(as_u128(&r["refunded"]), 12 * USDC);
    assert_eq!(as_u128(&env.config().await["allocated"]), 18 * USDC);
    env.execute(id1, 12 * USDC).await.fails_with("expected [Approved]");
    let merchant = env.view("receipts", "get_merchant", json!({"id": id("shop")})).await;
    assert_eq!(as_u128(&merchant["refunded_today"]), 12 * USDC);

    // a veto inside the window escalates to the merchant, who rejects
    let id2 = env.paid(30 * USDC, long("order-2")).await;
    env.request_refund(id2, 10 * USDC).await.success();
    env.call(
        "executor",
        "receipts",
        "ai_decide",
        json!({"id": id2, "decision": "approve", "amount": (10 * USDC).to_string(), "summary_hash": SUMMARY}),
    )
    .await
    .success();
    env.call("bob", "receipts", "veto", json!({"id": id2, "note": "x"}))
        .await
        .fails_with("merchant approver only");
    let out = env
        .call("approver", "receipts", "veto", json!({"id": id2, "note": "replacement was sent"}))
        .await
        .success();
    assert_eq!(out.event("vetoed")["note"], "replacement was sent");
    assert_eq!(env.request_state(id2).await, "Escalated");
    let out = env
        .call("approver", "receipts", "reject_refund", json!({"id": id2, "note": "no"}))
        .await
        .success();
    assert_eq!(out.event("refund_rejected")["receipt_id"], id2);
    assert_eq!(env.request_state(id2).await, "Rejected");
    env.request_refund(id2, USDC).await.fails_with("a refund request already exists");
    Ok(())
}

#[tokio::test]
async fn escalation_denial_appeal_silence_and_daily_cap() -> TestResult {
    let env = Env::new().await?;
    env.register_usdc("sink").await;
    let long = |order: &str| with(one_time(order), "window_secs", json!(100_000));
    let decide = |receipt_id: u64, decision: &str, amount: u128| {
        json!({"id": receipt_id, "decision": decision, "amount": amount.to_string(), "summary_hash": SUMMARY})
    };

    // 1. approval above auto_approve_max escalates; the merchant approves
    let id1 = env.paid(100 * USDC, long("order-1")).await;
    env.request_refund(id1, 60 * USDC).await.success();
    let out = env
        .call("executor", "receipts", "ai_decide", decide(id1, "approve", 60 * USDC))
        .await
        .success();
    let ev = out.event("ai_decided");
    assert_eq!((ev["decision"].as_str(), ev["state"].as_str()), (Some("approve"), Some("Escalated")));
    assert_eq!(env.request_state(id1).await, "Escalated");
    env.call("shop", "receipts", "approve_refund", json!({"id": id1}))
        .await
        .fails_with("merchant approver only");
    let out = env
        .call("approver", "receipts", "approve_refund", json!({"id": id1}))
        .await
        .success();
    assert_eq!(as_u128(&out.event("refund_approved")["amount"]), 60 * USDC);
    assert_eq!(env.execute(id1, 60 * USDC).await.json(), true);
    assert_eq!(env.usdc_balance("sink").await, 60 * USDC);

    // 2. deny -> appeal (once) -> escalated -> merchant rejects
    let id2 = env.paid(10 * USDC, long("order-2")).await;
    env.request_refund(id2, 10 * USDC).await.success();
    env.signed(id2, "appeal", "", json!({}))
        .await
        .fails_with("request is Open, expected [AiDenied]");
    env.call("executor", "receipts", "ai_decide", decide(id2, "deny", 0))
        .await
        .success();
    assert_eq!(env.request_state(id2).await, "AiDenied");
    env.call("approver", "receipts", "approve_refund", json!({"id": id2}))
        .await
        .fails_with("request is AiDenied");
    let out = env.signed(id2, "appeal", "", json!({})).await.success();
    assert_eq!(out.event("appealed")["receipt_id"], id2);
    let q = env.receipt(id2).await["request"].clone();
    assert_eq!(q["state"], "Escalated");
    assert_eq!(q["appealed"], true);
    env.signed(id2, "appeal", "", json!({}))
        .await
        .fails_with("request is Escalated, expected [AiDenied]");
    env.call("approver", "receipts", "reject_refund", json!({"id": id2, "note": "policy"}))
        .await
        .success();
    assert_eq!(env.request_state(id2).await, "Rejected");

    // 3. merchant without AI triage: silence means approval
    env.register_merchant("plain", false, 20 * USDC).await;
    let plain = |order: &str| with(long(order), "merchant_id", json!(id("plain")));
    let id3 = env.paid(15 * USDC, plain("order-3")).await;
    env.request_refund(id3, 15 * USDC).await.success();
    env.call("executor", "receipts", "ai_decide", decide(id3, "approve", USDC))
        .await
        .fails_with("merchant has not enabled AI triage");
    env.call("bob", "receipts", "finalize_request", json!({"id": id3}))
        .await
        .fails_with("decision deadline not reached");
    env.call("bob", "receipts", "release", json!({"id": id3}))
        .await
        .fails_with("refund request active");
    let deadline = as_u64(&env.receipt(id3).await["request"]["decision_deadline"]);
    env.advance_past(deadline).await;
    let out = env
        .call("bob", "receipts", "finalize_request", json!({"id": id3}))
        .await
        .success();
    assert_eq!(out.event("request_finalized")["from_state"], "Open");
    assert_eq!(env.request_state(id3).await, "Approved");
    assert_eq!(env.execute(id3, 15 * USDC).await.json(), true);
    assert_eq!(env.receipt(id3).await["status"], "Refunded");

    // 4. daily cap of `plain` is 20 USDC: 15 used, 6 more is refused, 5 is fine
    let id4 = env.paid(6 * USDC, plain("order-4")).await;
    env.call("approver", "receipts", "merchant_refund", json!({"id": id4, "amount": (6 * USDC).to_string()}))
        .await
        .success();
    env.execute(id4, 6 * USDC).await.fails_with("daily refund cap exceeded");
    let r = env.receipt(id4).await;
    assert_eq!(r["request"]["state"], "Approved");
    assert_eq!(r["request"]["by_merchant"], true);
    assert_eq!(as_u128(&r["refunded"]), 0);
    let id5 = env.paid(5 * USDC, plain("order-5")).await;
    env.call("approver", "receipts", "merchant_refund", json!({"id": id5, "amount": (5 * USDC).to_string()}))
        .await
        .success();
    assert_eq!(env.execute(id5, 5 * USDC).await.json(), true);
    let merchant = env.view("receipts", "get_merchant", json!({"id": id("plain")})).await;
    assert_eq!(as_u128(&merchant["refunded_today"]), 20 * USDC);
    // the merchant can raise the cap, then the stuck refund goes through
    env.register_merchant("plain", false, 100 * USDC).await;
    assert_eq!(env.execute(id4, 6 * USDC).await.json(), true);

    assert_eq!(env.usdc_balance("sink").await, 86 * USDC);
    let cfg = env.config().await;
    assert_eq!(as_u128(&cfg["allocated"]), 50 * USDC);
    assert_eq!(env.usdc_balance("receipts").await, 50 * USDC);
    Ok(())
}

#[tokio::test]
async fn cancel_refunds_unreleased_future_tranches() -> TestResult {
    let env = Env::new().await?;
    env.register_usdc("payout").await;
    env.register_usdc("sink").await;

    // 4 x 5 USDC: one due now, the others 200 s apart
    let start = env.now().await;
    let step = 200 * SEC;
    let tranches: Vec<(u64, u128)> = (0..4u64).map(|i| (start + i * step, 5 * USDC)).collect();
    let msg = schedule("sub-1", "Subscription", &tranches);

    env.fund("alice", 21 * USDC).await;
    let out = env.pay("alice", 21 * USDC, msg.clone()).await.success();
    assert_eq!(out.event("payment_rejected")["reason"], "schedule must sum to amount");
    let id1 = env.paid(20 * USDC, msg).await;

    env.request_refund(id1, USDC)
        .await
        .fails_with("use cancel for Subscription/Schedule receipts");

    // first tranche is due immediately
    let out = env.call("bob", "receipts", "release", json!({"id": id1})).await.success();
    assert_eq!(out.value, Some(json!(true)));
    assert_eq!(out.event("released")["status"], "PartiallyReleased");
    assert_eq!(env.usdc_balance("payout").await, 5 * USDC);
    env.call("bob", "receipts", "release", json!({"id": id1}))
        .await
        .fails_with("nothing to release");

    // move past the second tranche, do not release it, then cancel
    env.advance_past(start + step).await;
    assert!(env.now().await < start + 2 * step, "fast-forward overshot the test schedule");
    let out = env
        .signed(id1, "cancel", REASON, json!({"reason_hash": REASON}))
        .await
        .success();
    assert_eq!(as_u128(&out.event("cancelled")["amount"]), 10 * USDC);
    let ev = out.event("refund_requested");
    assert_eq!(as_u128(&ev["amount"]), 10 * USDC);
    assert_eq!(ev["is_cancel"], true);
    let r = env.receipt(id1).await;
    assert_eq!(r["request"]["state"], "Open");
    assert_eq!(r["request"]["is_cancel"], true);
    assert_eq!(as_u128(&r["request"]["amount"]), 10 * USDC);
    assert_eq!(tranche_states(&r), ["Released", "Pending", "RefundPending", "RefundPending"]);

    // release is blocked while the request is active, even for the due tranche
    env.call("bob", "receipts", "release", json!({"id": id1}))
        .await
        .fails_with("refund request active");
    // a cancel is all or nothing
    env.call(
        "executor",
        "receipts",
        "ai_decide",
        json!({"id": id1, "decision": "partial", "amount": USDC.to_string(), "summary_hash": SUMMARY}),
    )
    .await
    .fails_with("a cancel request cannot be approved partially");
    env.call("approver", "receipts", "approve_refund", json!({"id": id1}))
        .await
        .success();
    assert_eq!(env.execute(id1, 10 * USDC).await.json(), true);
    assert_eq!(env.usdc_balance("sink").await, 10 * USDC);

    // the due tranche still belongs to the merchant
    assert_eq!(
        env.call("bob", "receipts", "release", json!({"id": id1})).await.json(),
        true
    );
    assert_eq!(env.usdc_balance("payout").await, 10 * USDC);
    let r = env.receipt(id1).await;
    assert_eq!(r["status"], "PartiallyRefunded");
    assert_eq!(as_u128(&r["released"]), 10 * USDC);
    assert_eq!(as_u128(&r["refunded"]), 10 * USDC);
    assert_eq!(tranche_states(&r), ["Released", "Released", "Refunded", "Refunded"]);
    assert_eq!(as_u128(&env.config().await["allocated"]), 0);
    assert_eq!(env.usdc_balance("receipts").await, 0);

    // merchant-initiated refund of a schedule takes every Pending tranche
    let start = env.now().await;
    let plan = schedule(
        "plan-2",
        "Schedule",
        &[(start + 1000 * SEC, 8 * USDC), (start + 2000 * SEC, 8 * USDC)],
    );
    let id2 = env.paid(16 * USDC, plan).await;
    let refund = |amount: u128| json!({"id": id2, "amount": amount.to_string()});
    env.call("bob", "receipts", "merchant_refund", refund(16 * USDC))
        .await
        .fails_with("merchant approver only");
    env.call("approver", "receipts", "merchant_refund", refund(8 * USDC))
        .await
        .fails_with("amount must equal the sum of all Pending tranches");
    let out = env
        .call("approver", "receipts", "merchant_refund", refund(16 * USDC))
        .await
        .success();
    assert_eq!(out.event("refund_approved")["by_merchant"], true);
    assert_eq!(tranche_states(&env.receipt(id2).await), ["RefundPending", "RefundPending"]);
    assert_eq!(env.execute(id2, 16 * USDC).await.json(), true);
    assert_eq!(env.receipt(id2).await["status"], "Refunded");
    assert_eq!(env.usdc_balance("sink").await, 26 * USDC);
    Ok(())
}

#[tokio::test]
async fn signatures_claim_and_transfer() -> TestResult {
    let env = Env::new().await?;
    let long = |order: &str| with(one_time(order), "window_secs", json!(100_000));
    let id1 = env.paid(10 * USDC, long("order-1")).await;
    let request = |amount: u128, sig: Option<String>| {
        json!({"id": id1, "amount": amount.to_string(), "reason_hash": REASON, "sig": sig})
    };

    // missing, garbage, tampered and misdirected signatures
    env.call("relayer", "receipts", "request_refund", request(USDC, None))
        .await
        .fails_with("sig required for unclaimed receipt");
    env.call("relayer", "receipts", "request_refund", request(USDC, Some("00".repeat(64))))
        .await
        .fails_with("invalid signature");
    let sig_1usdc = sign(id1, "request_refund", &format!("{USDC}|{REASON}"), 0);
    env.call("relayer", "receipts", "request_refund", request(10 * USDC, Some(sig_1usdc.clone())))
        .await
        .fails_with("invalid signature");
    let claim_alice = sign(id1, "claim", id("alice").as_str(), 0);
    env.call(
        "bob",
        "receipts",
        "claim",
        json!({"id": id1, "account": id("bob"), "sig": claim_alice}),
    )
    .await
    .fails_with("invalid signature");
    env.call(
        "bob",
        "receipts",
        "confirm_received",
        json!({"id": id1, "sig": sign(id1, "appeal", "", 0)}),
    )
    .await
    .fails_with("invalid signature");
    assert_eq!(env.receipt(id1).await["nonce"], 0);

    // a relayed signature changes the refund target; replaying it does nothing
    let new_target = json!({"chain": "base", "asset": "usdc", "address": "0x00000000000000000000000000000000000000bb"});
    let target_sig = sign(
        id1,
        "set_refund_target",
        "base|usdc|0x00000000000000000000000000000000000000bb",
        0,
    );
    let set_target = json!({"id": id1, "target": new_target, "sig": target_sig});
    let out = env
        .call("relayer", "receipts", "set_refund_target", set_target.clone())
        .await
        .success();
    assert_eq!(out.event("refund_target_changed")["refund_target"], new_target);
    assert_eq!(env.receipt(id1).await["nonce"], 1);
    env.call("bob", "receipts", "set_refund_target", set_target)
        .await
        .fails_with("invalid signature");
    // the 1-USDC signature was made for nonce 0 and is dead now
    env.call("relayer", "receipts", "request_refund", request(USDC, Some(sig_1usdc)))
        .await
        .fails_with("invalid signature");

    // claim: the signature binds the account; works for non-transferable receipts
    let out = env
        .signed(id1, "claim", id("alice").as_str(), json!({"account": id("alice")}))
        .await
        .success();
    assert_eq!(out.event("claimed")["owner_id"], json!(id("alice")));
    let r = env.receipt(id1).await;
    assert_eq!(r["owner_id"], json!(id("alice")));
    assert_eq!(r["claimed"], true);
    assert!(r["receipt_key"].is_null());
    env.call(
        "relayer",
        "receipts",
        "claim",
        json!({"id": id1, "account": id("bob"), "sig": sign(id1, "claim", id("bob").as_str(), 2)}),
    )
    .await
    .fails_with("receipt already claimed");

    // the receipt key no longer authorises anything; the owner acts directly
    env.call(
        "relayer",
        "receipts",
        "request_refund",
        request(USDC, Some(sign(id1, "request_refund", &format!("{USDC}|{REASON}"), 2))),
    )
    .await
    .fails_with("not the receipt owner");
    let out = env
        .call("alice", "receipts", "request_refund", request(4 * USDC, None))
        .await
        .success();
    assert_eq!(out.event("refund_requested")["refund_target"], new_target);

    // one-time receipts are not transferable by default
    env.call_with(
        "alice",
        "receipts",
        "nft_transfer",
        json!({"receiver_id": id("bob"), "token_id": id1.to_string()}),
        NearToken::from_yoctonear(1),
    )
    .await
    .fails_with("receipt is not transferable");

    // a pass is transferable: claim, transfer, and the new owner holds the rights
    let now = env.now().await;
    let pass = schedule("pass-1", "Subscription", &[(now + 5000 * SEC, 9 * USDC)]);
    let id2 = env.paid(9 * USDC, pass).await;
    let token_id = id2.to_string();
    env.signed(id2, "claim", id("alice").as_str(), json!({"account": id("alice")}))
        .await
        .success();
    let transfer = json!({"receiver_id": id("bob"), "token_id": token_id});
    env.call_with("bob", "receipts", "nft_transfer", transfer.clone(), NearToken::from_yoctonear(1))
        .await
        .fails_with("Approval extension is disabled");
    env.call_with(
        "alice",
        "receipts",
        "nft_transfer",
        json!({"receiver_id": id("receipts"), "token_id": token_id}),
        NearToken::from_yoctonear(1),
    )
    .await
    .fails_with("cannot transfer a receipt to the contract account");
    env.call_with("alice", "receipts", "nft_transfer", transfer, NearToken::from_yoctonear(1))
        .await
        .success();
    let token = env.view("receipts", "nft_token", json!({"token_id": token_id})).await;
    assert_eq!(token["owner_id"], json!(id("bob")));
    let owned = env
        .view("receipts", "nft_tokens_for_owner", json!({"account_id": id("bob")}))
        .await;
    assert_eq!(owned.as_array().unwrap().len(), 1);
    let for_bob = env
        .view("receipts", "receipts_for_owner", json!({"account_id": id("bob")}))
        .await;
    assert_eq!(for_bob[0]["id"], id2);
    let for_alice = env
        .view("receipts", "receipts_for_owner", json!({"account_id": id("alice")}))
        .await;
    assert_eq!(for_alice.as_array().unwrap().len(), 1, "alice still owns receipt 1");
    assert_eq!(for_alice[0]["id"], id1);

    let cancel = json!({"id": id2, "reason_hash": REASON});
    env.call("alice", "receipts", "cancel", cancel.clone())
        .await
        .fails_with("not the receipt owner");
    env.call("alice", "receipts", "set_refund_target", json!({"id": id2, "target": new_target}))
        .await
        .fails_with("not the receipt owner");
    env.call("bob", "receipts", "set_refund_target", json!({"id": id2, "target": new_target}))
        .await
        .success();
    let out = env.call("bob", "receipts", "cancel", cancel).await.success();
    assert_eq!(as_u128(&out.event("cancelled")["amount"]), 9 * USDC);
    assert_eq!(env.request_state(id2).await, "Open");

    // the refund target is frozen once the refund is approved
    env.call("approver", "receipts", "approve_refund", json!({"id": id2}))
        .await
        .success();
    env.call("bob", "receipts", "set_refund_target", json!({"id": id2, "target": refund_target()}))
        .await
        .fails_with("a refund is approved and about to be executed");
    Ok(())
}

#[tokio::test]
async fn private_callbacks_and_admin_checks() -> TestResult {
    let env = Env::new().await?;
    let id1 = env.paid(5 * USDC, one_time("order-1")).await;

    // callbacks are private
    env.call(
        "executor",
        "receipts",
        "on_transfer_resolved",
        json!({"id": id1, "kind": "release", "amount": "1", "tranches": [], "to": id("executor"), "quote_id": null}),
    )
    .await
    .fails_with("Method on_transfer_resolved is private");
    env.call(
        "executor",
        "receipts",
        "on_mint_balance",
        json!({"args": mint_args("x", 1), "settled_at_init": "0"}),
    )
    .await
    .fails_with("Method on_mint_balance is private");
    env.call("executor", "receipts", "mint_failed", json!({"reason": "x"}))
        .await
        .fails_with("Method mint_failed is private");

    // only the USDC contract may report a payment
    env.call(
        "alice",
        "receipts",
        "ft_on_transfer",
        json!({"sender_id": id("alice"), "amount": "1000000", "msg": one_time("fake").to_string()}),
    )
    .await
    .fails_with("only the USDC contract may call ft_on_transfer");

    // executor rotation is owner only, and the old executor loses access
    env.call("executor", "receipts", "set_executor", json!({"executor": id("bob")}))
        .await
        .fails_with("owner only");
    env.call("executor", "receipts", "reset_mint_lock", json!({}))
        .await
        .fails_with("owner only");
    env.call("owner", "receipts", "set_executor", json!({"executor": id("bob")}))
        .await
        .success();
    env.fund("receipts", USDC).await;
    env.mint(mint_args("order-2", USDC)).await.fails_with("executor only");
    let out = env
        .call("bob", "receipts", "mint_receipt", json!({"args": mint_args("order-2", USDC)}))
        .await;
    assert_eq!(out.json(), 2);
    Ok(())
}
