# Universal Checkout — Build Spec (NEAR Hackathon 2026)

> One button for every way money moves.
> Customers pay in any coin on any chain (via NEAR Intents); merchants get USDC.
> Every payment becomes a **receipt NFT that holds the money** during a refund window.
> Refunds go back to the customer's original chain and coin. Prepaid subscriptions and
> scheduled payments release over time; cancelling refunds the unreleased part.

Deadline: **14 Nov 2026, 23:59 UTC** (15 Nov 05:29 IST). Tracks: **Real-World Money** (primary), **NFTs That Do Something**, plus Open / Privacy if the AI refund agent ships.

---

## 0. Non-negotiables

1. **No real money by default.** Every command runs in `local` mode unless told otherwise. Mainnet is touched by exactly one opt-in script (§9) with a hard $2 cap.
2. **Judges must be able to run it with zero setup.** `pnpm install && pnpm demo` must work on a clean machine with no API keys, no wallets, no testnet accounts. (The hackathon's first screen is Claude Code/Codex cloning the repo and following the README.)
3. **README claims only what actually works.** Unfinished features are listed as "planned", never shown as done.
4. Public repo. No secrets committed. `.env.example` documents every variable.

---

## 1. Run modes (one switch: `UC_MODE`)

| Mode | Chain | Swaps | Who uses it |
|---|---|---|---|
| `local` (default) | NEAR **sandbox** via `near-workspaces` (local chain, spun up by the demo script) | **Mock adapter** — mints fake USDC to the receipt contract, logs a fake refund | Judges, AI first screen, development |
| `testnet` | NEAR testnet | Mock adapter or **Tidepool** sandbox; prices from real 1Click **dry quotes** (`dry: true`) | Hosted demo, video |
| `live` | NEAR mainnet (1Click only) | Real **NEAR Intents 1Click API** | Only `scripts/mainnet-proof` (§9) |

NEAR Intents has **no testnet** ("There's no testnet deployment and no plans for it" — official FAQ), which is why swaps are mocked outside `live`.

---

## 2. Architecture

```
 Entry points                 Backend                    Settlement / AI            Chain & external
 ─────────────                ─────────                  ──────────────             ─────────────────
 <pay-button> / link / QR ─┐
 Checkout + receipt pages ─┤                          ┌─ Settlement worker ──────► Receipt contract (NEAR)
 Merchant dashboard ───────┼──► Backend API ──────────┤   (mint, release, refund)     │
 WooCommerce plugin ───────┤    sessions, quotes,     │        ▲                      └─► Merchant payout (Trezu / any account)
 Shopify app (stretch) ────┤    webhooks, status      │   AI refund agent
 MCP server (agents) ──────┘         │                │   (NEAR AI, policy-bound)
                                     └──► Intents adapter ──► mock | tidepool | 1Click (live)
                                                                     ▲
                                                         Customer wallet (any coin, any chain)
```

Phase 2 (stretch): run the settlement worker inside **OutLayer** (TEE, attested runs) on testnet so every mint/release/refund carries a hardware attestation.

---

## 3. Repo layout (pnpm monorepo)

```
/contracts/receipts         Rust, near-sdk + near-contract-standards (NEP-171 NFT)
/contracts/mock-usdc        Simple NEP-141 token for sandbox/testnet (6 decimals)
/packages/intents-adapter   TS: interface + MockAdapter, TidepoolAdapter, OneClickAdapter
/packages/sdk               TS: <pay-button> web component + tiny JS client (built with Vite lib mode → dist/pay.js)
/apps/web                   Next.js (App Router): hosted checkout, receipt page, merchant dashboard, demo shop, API routes
/services/settlement        TS worker: watches sessions/contract, mints receipts, runs releases, executes refunds
/services/mcp               TS MCP server exposing checkout tools to AI agents
/plugins/woocommerce        PHP WooCommerce payment gateway plugin
/plugins/shopify            (stretch) Shopify app: thank-you page extension + mark-paid
/scripts                    demo, deploy-testnet, seed, mainnet-proof
README.md  SPEC.md  CLAUDE.md  .env.example
```

DB: Prisma + SQLite (`local`), Postgres (hosted `testnet`, e.g. Neon free tier). Same schema.

---

## 4. Receipt contract (`/contracts/receipts`)

### State
```rust
struct Receipt {
  id: u64,                       // also the NFT token_id (as string)
  merchant_id: AccountId,
  order_ref: String,             // merchant's order id / session id
  amount: U128,                  // USDC (6 dp) held for this receipt
  released: U128,                // already paid to merchant
  refunded: U128,                // already refunded
  kind: Kind,                    // OneTime | Subscription | Schedule
  window_end: u64,               // ns timestamp; OneTime refund window end
  schedule: Vec<Tranche>,        // Subscription/Schedule: { at: u64, amount: U128, state: Pending|Released|Refunded }
  refund_target: RefundTarget,   // { chain: String, asset: String, address: String }  e.g. ("polygon","usdt","0x…")
  secret_hash: Option<[u8;32]>,  // sha256(secret) for unclaimed receipts; cleared on claim
  status: Status,                // Held | PartiallyReleased | Released | RefundRequested | PendingApproval | Refunded
  pending_refund: U128,
  created_at: u64,
}
struct Merchant { payout: AccountId, approver: AccountId, guard_threshold: U128, default_window_secs: u64 }
```
Contract config: `usdc: AccountId`, `executor: AccountId` (settlement worker key), `allocated: U128` (sum of unreleased, unrefunded amounts).

NFT: every receipt is minted as a NEP-171 token. **Unclaimed** tokens are owned by the contract itself; `claim` transfers to the customer's NEAR account. After claim, the token owner controls the rights, standard `nft_transfer` moves them, and the owner may update `refund_target`.

### Methods
| Method | Who | What |
|---|---|---|
| `new(usdc, executor, owner)` | deploy | init |
| `register_merchant(payout, approver, guard_threshold, default_window_secs)` | merchant | create/update config |
| `mint_receipt(args)` | **executor only** | Calls `usdc.ft_balance_of(self)`; in callback require `balance >= allocated + amount`, then store receipt, `allocated += amount`, mint NFT. (1Click delivers USDC with a plain transfer that carries no order id, so the contract only credits money it can see but hasn't assigned yet.) |
| `release(id)` | **anyone** | OneTime: if `now >= window_end` and no pending refund → transfer remaining to merchant payout. Schedules: release every tranche with `at <= now`. Updates `allocated`. |
| `request_refund(id, amount, secret?)` | holder (secret or NFT owner) | If `amount > guard_threshold` → `PendingApproval`, else `RefundRequested`. Emits event. Only unreleased funds are refundable. |
| `approve_refund(id)` / `reject_refund(id)` | merchant approver | guard |
| `cancel(id, secret?)` | holder | Subscription/Schedule: all `Pending` tranches → refund request (pro-rata) |
| `execute_refund(id, deposit_account, amount)` | **executor only** | `ft_transfer` USDC to `deposit_account` (the 1Click deposit address on NEAR for the reverse swap, or the mock sink). Marks refunded, `allocated -= amount`. |
| `claim(id, secret, account)` | anyone with secret | transfer NFT to `account`, clear `secret_hash` |
| `set_refund_target(id, target)` | NFT owner (claimed only) | — |
| views | — | `get_receipt`, `receipts_for_merchant`, `receipts_for_owner`, `get_merchant`, NEP-171 views |

Events: NEP-297 JSON logs (`EVENT_JSON:`) for `receipt_minted`, `released`, `refund_requested`, `refund_pending_approval`, `refund_executed`, `claimed`, `cancelled`.

Policy: refunds are in **USDC value** (amount held), converted back to the customer's coin at the refund-day rate; swap fee on refund is paid from the refunded amount (document in README).

Known trust assumption (state it in README): `execute_refund` trusts the executor to pass a correct deposit address for `refund_target`. Phase 2 (OutLayer TEE + attestation) narrows this.

Tests: `cargo test` unit tests + `near-workspaces` integration tests for: mint gating on unassigned balance, release after window, refund under/over guard, cancel pro-rata, claim + transfer, executor-only checks.

---

## 5. Intents adapter (`/packages/intents-adapter`)

```ts
interface IntentsAdapter {
  quotePay(p: { originAsset: string; amountUsd: string; refundTo: string; recipientNear: string; deadlineMins?: number }): Promise<Quote>;
  quoteRefund(p: { amountUsdc: string; targetAsset: string; targetAddress: string; refundToNear: string }): Promise<Quote>;
  status(depositAddress: string, memo?: string): Promise<'PENDING_DEPOSIT'|'PROCESSING'|'SUCCESS'|'REFUNDED'|'FAILED'|string>;
  submitDeposit?(depositAddress: string, txHash: string): Promise<void>;
  listTokens(): Promise<Token[]>;
}
interface Quote { depositAddress: string; depositMemo?: string; amountIn: string; amountOut: string; deadline: string; raw: unknown }
```
- **OneClickAdapter** (live): base URL `https://1click.chaindefuser.com`, endpoints `/v0/tokens`, `/v0/quote` (supports `dry: true`), `/v0/status?depositAddress=…`, `/v0/deposit/submit`. Optional JWT (`ONECLICK_JWT`) avoids the 0.2% fee. Quote fields include `refundTo`, `refundType` (`ORIGIN_CHAIN`), `recipient`, `recipientType`, `deadline`. **Verify exact field names against https://1click.chaindefuser.com/docs/v0/openapi.yaml before coding.**
- **MockAdapter** (local/testnet): returns a fake deposit address; a `simulatePayment(depositAddress)` helper mints/transfers mock USDC to the receipt contract and flips status to `SUCCESS`. Prices: fixed table in `local`; in `testnet`, real numbers from a 1Click **dry** quote when network allows, else the table.
- **TidepoolAdapter** (optional): same API shape as 1Click, pointed at the Tidepool sandbox (https://github.com/Watchmeecryt/tidepool). Only use if it actually runs; otherwise MockAdapter.

---

## 6. Backend API (`/apps/web/app/api`)

| Route | Purpose |
|---|---|
| `POST /api/sessions` | Create payment session `{merchantId, amountUsd, kind, schedule?, orderRef, metadata}` → `{sessionId, checkoutUrl}` |
| `GET /api/sessions/:id` | Status for checkout page polling |
| `POST /api/sessions/:id/quote` | Customer picked `{originAsset, refundAddress}` → adapter quote → deposit address + amount + QR payload |
| `POST /api/receipts/:id/refund` | Customer (secret) or owner requests refund (proxies to contract) |
| `POST /api/receipts/:id/cancel` | Cancel subscription/schedule |
| `POST /api/receipts/:id/dispute` | Customer message + optional image → AI refund agent (§8) |
| `GET /api/merchants/:id/receipts` | Dashboard list |
| `POST /api/merchants` | Register merchant + payout + guard + window + webhook URL + secret |
| Webhooks out | `payment.succeeded`, `receipt.released`, `refund.requested`, `refund.executed`, `subscription.cancelled` — body JSON, header `X-UC-Signature: sha256=<HMAC(secret, body)>`. Merchants **must** verify server-side; the button alone is never proof of payment. |

Session lifecycle: `created → quoted → deposit_detected → paid (receipt minted) → released | refund_requested → refunded`.

---

## 7. Front end

### `<pay-button>` (`/packages/sdk`)
```html
<script src="https://<host>/pay.js" defer></script>
<pay-button merchant="shop.testnet" amount="49" product="Ebook" mode="one-time"
            label="Pay any way" color="#4F46E5" radius="12"></pay-button>
```
- Shadow DOM, CSS variables for theme, no framework dependency, < 15 KB gzipped.
- `mode`: `one-time` | `subscription` (attrs: `months`, `monthly`) | `schedule` (attr: `tranches` JSON).
- Click → opens hosted checkout in a modal iframe (fallback: redirect). Emits DOM events `uc:paid`, `uc:closed`.
- Same session can be shared as **link** or **QR** (dashboard generates both).

### Hosted pages (`/apps/web`)
- **Checkout**: pick coin/chain (searchable list from `listTokens`), enter refund address (prefilled for connected wallet if any), show quote, deposit address + QR, live status steps (Waiting → Detected → Swapping → Paid ✓). In `local`/`testnet`, a visible **"Simulate payment"** button.
- **Receipt page** (`/r/:id#secret`): amount, status, refund window countdown or tranche timeline, buttons: Request refund · Cancel · Claim to NEAR account · Open dispute. Secret lives in the URL fragment (never sent in logs); hash compared on-chain.
- **Merchant dashboard**: register, set payout/guard/window/webhook, product links, **live button styler** (colour, radius, label, preview + copy snippet), receipts table with status + actions, refund approvals, AI policy settings.
- **Demo shop** (`/shop`): fake store with 3 products using `<pay-button>` (one-time, 3-month subscription, milestone schedule).

Design: clean, single accent colour, smooth transitions; this is what the video shows — make it look like a real fintech product.

---

## 8. AI refund agent

- Customer opens dispute on receipt page: text + optional photo.
- Merchant policy (dashboard): e.g. `auto_approve_max_usd: 20`, `within_days: 7`, `categories_allowed: ["damaged","not_received"]`.
- Agent: OpenAI-compatible chat call to **NEAR AI Cloud** (private inference). Base URL + model from env (`NEARAI_BASE_URL`, `NEARAI_API_KEY`, `NEARAI_MODEL`; credits via NEAR Builders profile). **Verify the endpoint shape in NEAR AI Cloud docs.** Output strict JSON `{decision: "refund"|"escalate"|"reject", amount, reason}`.
- Decision is **bounded by policy in code**, not by the model: anything above `auto_approve_max_usd` → escalate.
- No API key (local mode) → deterministic rule-based fallback so the demo still works.
- Refund decisions go through the normal `request_refund` path (guard still applies).

---

## 9. Mainnet proof (`scripts/mainnet-proof.ts`) — opt-in, ≤ $2

Runs only with `UC_MODE=live CONFIRM_REAL_MONEY=yes MAX_USD=2`.
1. `GET /v0/tokens`, then a **dry** quote for $1 Polygon USDT → USDC on NEAR. Abort if below 1Click's minimum or above `MAX_USD`.
2. Real quote → print the **Polygon deposit address** and exact amount. Human sends from **MetaMask** (needs a few cents of POL). Script polls `/v0/status` until `SUCCESS`; saves tx links to `proof.json`.
3. Refund leg: quote USDC (NEAR) → USDT (Polygon) to the MetaMask address; transfer USDC from the NEAR proof account to the returned deposit address (needs a little NEAR for gas); poll; save links.
4. README embeds `proof.json` links: "cross-chain payment and refund proven on mainnet; escrow logic runs on testnet/sandbox."

Never import a private key from code; use near-cli-rs keychain or `NEAR_PROOF_ACCOUNT` + credentials file outside the repo.

---

## 10. Integrations

- **WooCommerce** (`/plugins/woocommerce`): class extends `WC_Payment_Gateway`; on checkout creates a session via API and redirects to hosted checkout; webhook endpoint verifies HMAC and calls `$order->payment_complete()`; refund button in WooCommerce admin calls `/api/receipts/:id/refund`. Local test: WordPress + WooCommerce via Docker (`docker compose` in plugin folder).
- **Shopify (stretch)**: Shopify only allows checkout payment apps for approved Payments Partners (invite-only), so use the standard workaround (as BTCPay Server and MixPay do): merchant adds a manual payment method "Pay with crypto"; our app adds a **Thank-you / Order status page checkout UI extension** showing the pay button; on `payment.succeeded` webhook, call Admin GraphQL `orderMarkAsPaid`. Needs a free Shopify Partner account + dev store.
- **MCP server** (`/services/mcp`): tools `list_products`, `create_payment`, `get_payment_status`, `simulate_payment` (non-live only), `request_refund`, `get_receipt`. Demo: an AI agent buys from the demo shop.

---

## 11. Commands

| Command | Does |
|---|---|
| `pnpm demo` | Starts NEAR sandbox, deploys `mock-usdc` + `receipts`, seeds a merchant + products, starts web + settlement worker, prints URLs (shop, dashboard). No keys needed. |
| `pnpm test` | Contract unit + integration tests, adapter tests, API tests |
| `pnpm deploy:testnet` | Deploys contracts to testnet accounts from env, writes addresses to `.env.testnet` |
| `pnpm dev` | Web + worker against current `UC_MODE` |
| `pnpm proof:mainnet` | §9, guarded |

---

## 12. Sprint checklist (order = priority; stop-and-demo after each block)

### A. Foundation
- [ ] Monorepo scaffold, pnpm workspaces, `.env.example`, CI running `pnpm test`
- [ ] `mock-usdc` NEP-141 contract
- [ ] `pnpm demo` boots sandbox + deploys contracts (empty app OK)

### B. Receipt contract (must)
- [ ] Receipt + Merchant state, NEP-171 mint
- [ ] `mint_receipt` gated on unassigned USDC balance (executor only)
- [ ] `release` (window + tranches), anyone can call
- [ ] `request_refund` / guard / `approve_refund` / `execute_refund`
- [ ] `claim`, `set_refund_target`, transfers
- [ ] `cancel` with pro-rata refund
- [ ] Events + full test suite

### C. Payment path end-to-end in `local` (must)
- [ ] Intents adapter interface + MockAdapter (+ dry-quote prices)
- [ ] Sessions API + Prisma schema
- [ ] Settlement worker: detect payment → `mint_receipt`; scheduled `release`; refunds → `execute_refund`
- [ ] Hosted checkout with Simulate payment + status steps
- [ ] Receipt page: refund / cancel / claim
- [ ] Signed webhooks

### D. Merchant + button (must)
- [ ] `<pay-button>` web component + build to `pay.js`
- [ ] Dashboard: register, settings, receipts table, approvals
- [ ] Live button styler + link + QR generator
- [ ] Demo shop with one-time / subscription / schedule products

### E. Integrations (should)
- [ ] WooCommerce plugin + docker test store
- [ ] MCP server + agent purchase demo
- [ ] Shopify thank-you app + mark paid (stretch)

### F. AI refund agent (should)
- [ ] Policy settings
- [ ] NEAR AI call with policy-bounded decision + local fallback

### G. Testnet + proof
- [ ] `pnpm deploy:testnet` + hosted deployment (Vercel + Neon)
- [ ] (optional) Tidepool adapter
- [ ] (optional, ≤ $2) `pnpm proof:mainnet` with MetaMask, links in README
- [ ] (stretch) Settlement worker on OutLayer testnet with attestations

### H. Ship
- [ ] README: what/why, 60-second quickstart (`pnpm demo`), mode table, architecture, trust assumptions, what's simulated, tx links, "built at NEAR HACKATHON"
- [ ] Self-test: fresh clone in a temp dir, follow README exactly, fix every failure
- [ ] Demo video (montage: QR, link, button recolour, pay, receipt, refund, subscription transfer + cancel, AI dispute, WooCommerce)
- [ ] X post tagging @NEARProtocol #NEARHackathon + submission form (repo + post links, NEAR wallet for prizes)
