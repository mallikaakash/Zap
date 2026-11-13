# Universal Checkout

**One button for every way money moves.** A seller adds two lines to any website. Customers pay with any coin on any chain through [NEAR Intents](https://docs.near-intents.org), and the seller receives USDC. Every payment becomes a **receipt NFT that holds the money** until the refund period ends. Refunds go back to the customer's original chain and coin, and a refund assistant answers first, within limits the seller sets and the contract enforces.

```html
<script src="https://YOUR-HOST/pay.js" defer></script>
<pay-button merchant="seller.near" amount="49" product="Ebook"></pay-button>
```

Built at NEAR HACKATHON 2026. Hackathon prototype, unaudited, not a licensed money service. Funds are held by a public contract, not by a company.

---

## Try it in 60 seconds (no keys, no wallet, no money)

```bash
pnpm install
pnpm demo
```

Needs Node 22+ and pnpm. `pnpm demo` does the following:
1. starts a **local NEAR sandbox** (the first run downloads a ~60 MB binary);
2. deploys the prebuilt contracts from `contracts/artifacts/`, so **no Rust is needed**;
3. creates a demo shop with three products;
4. starts the web app and the settlement worker, then prints the links.

Then:

1. Open **/shop**, click a button, pick any coin, enter a refund address, and press **Simulate payment**.
2. Open the receipt. It shows how much is held, the refund window, and every on-chain event.
3. Press **Request refund** and say the item arrived broken. The assistant asks for a photo; attach one and it approves.
4. In the seller dashboard (the link printed by `pnpm demo`), use **+1 min** on the sandbox clock and watch the refund go back.
5. Buy the **pass**: periods release to the shop over time. Claim it to an account, transfer it, cancel it, and the periods not yet started come back.
6. Emails the app would send appear at **/dev/inbox**.

`pnpm test` runs the TypeScript tests. `cd contracts && cargo test` runs the contract unit and sandbox tests (needs Rust).

---

## What works

| | |
|---|---|
| **Drop-in button** | `<pay-button>` web component: 8.6 KB gzipped, no dependencies, Shadow DOM, themable, accessible. Opens a hosted checkout in a modal and emits `uc:paid` / `uc:closed`. |
| **Links and QR codes** | `/pay?merchant=…&product-id=…` creates a session and redirects; the dashboard makes the QR code. |
| **Any coin in, USDC out** | NEAR Intents 1Click quotes `EXACT_OUTPUT` swaps that deliver USDC straight to the receipt contract. Any of the ~230 assets 1Click lists. Also **"Pay with USDC on NEAR"** with no swap (`ft_transfer_call`). |
| **Pay with MetaMask** | For EVM coins the checkout connects MetaMask, switches network and sends the exact amount. Other chains get the deposit address and a QR code. |
| **Receipt NFT that holds the money** | NEP-171 token per payment. The USDC stays in the contract until the refund window ends, then is released to the seller. Anyone can trigger a release that is due; the contract enforces the rules. |
| **Refunds to the original chain** | Refunds are converted back through 1Click and sent to the customer's address on the chain and coin they paid with. |
| **Refund assistant** | First responder on every request: asks up to 3 clarifying questions (for example a photo for damage), checks the seller's policy and fulfilment status, approves small clear cases, denies only objective violations (appeal once), and escalates the rest with a summary. Limits are enforced in code and on chain, not in the prompt. Uses NEAR AI Cloud when `NEARAI_API_KEY` is set; otherwise a deterministic rule engine with the same output. |
| **Seller protections** | Guard threshold, a veto window on AI approvals, a daily refund cap, and a decision deadline where silence means approval (customer protection). |
| **Prepaid passes and milestones** | Released period by period. Cancelling refunds the periods not yet started. Passes are transferable NFTs; one-time receipts are not. |
| **No raw secrets on chain** | The customer's browser creates an ed25519 **receipt key**; only the public key goes on chain. Actions are signed in the browser over the exact parameters plus a nonce, and the server only relays them, paying the gas. |
| **Seller onboarding** | Name, email and the NEAR account to be paid to. No wallet popups: the operator registers the shop on chain. A private dashboard link is the login. |
| **Seller dashboard** | Orders with escrow state, approve/decline/object, refund what is in escrow, collect payout, fulfilment status, products (one-time with refund window, or pass with interval), button styler with copy-paste snippet, settings, webhook and email log. |
| **Notifications** | Signed webhooks (`X-UC-Signature: sha256=HMAC(secret, "timestamp.body")`, 5-minute tolerance, event ids, retries) and emails through Resend. |
| **Public verification** | `/verify/:id` shows a receipt's attribution, where each refund was sent compared with the on-chain refund target, and whether the contract's USDC covers every open receipt. |
| **Health check** | `GET /api/health` answers `{ ok, mode, networkId, database }`: 200 when the database answers, 503 otherwise. No chain calls, so it is cheap for uptime checks. |

## What is simulated, and where

| Mode | Chain | Swaps | Used for |
|---|---|---|---|
| `local` (default, `pnpm demo`) | NEAR sandbox on your machine | **Simulated**: a mock adapter mints mock USDC to the contract and marks refunds delivered. The contract logic is the real one. | Trying it, development, tests |
| `live` (`pnpm deploy:mainnet` + `pnpm start`) | **NEAR mainnet**, real USDC | **Real NEAR Intents 1Click** | The real product |

NEAR Intents has no testnet, so there is no in-between mode. Every page outside live mode shows a "Simulated" badge.

## Running it for real (mainnet)

[docs/GO-LIVE.md](docs/GO-LIVE.md) is the operator's step-by-step guide: fund the operator account, import its key, run `pnpm deploy:mainnet` (it shows a plan and cost first and acts only with `--yes`), set up HTTPS, then `pnpm start`. The total is about **5.5 NEAR**, of which ~3.8 NEAR is storage for the contract code (locked, not spent), plus a few dollars for test purchases.

On **Cloud Run**, [docs/gcp-cloud-run.md](docs/gcp-cloud-run.md) covers deploys and how to keep the SQLite database across them with Litestream and a Cloud Storage bucket (one instance, CPU always on). Until a bucket is configured, each new revision starts with an empty database.

Real quotes from 1Click, November 2026: paying $1 with Polygon USDT costs 1.0156 USDT (including a 1% slippage buffer that is returned if unused); refunding $1 returns 0.9904 USDT.

## How it fits together

```
 seller's site                  our web app (Next.js)              settlement worker               NEAR mainnet
 ─────────────                  ─────────────────────              ─────────────────               ────────────
 <pay-button> ──► checkout ──► sessions / quotes ──► 1Click ──► USDC delivered to ──► receipt contract
 link / QR        receipt page   relays signed actions   (NEAR Intents)  checkout.<op>.near      (NEP-171 + escrow)
                  dashboard      AI triage (NEAR AI)                         │                       │
                                 webhooks + email      ◄── mint_receipt, ai_decide, release, ───┘    └─► seller payout (USDC)
                                                            execute_refund → 1Click → customer's chain
```

| Path | What |
|---|---|
| `contracts/receipts` | Rust receipt contract: escrow, refund state machine, receipt-key signatures, pause, cap. Interface: [contracts/INTERFACE.md](contracts/INTERFACE.md). |
| `contracts/mock-usdc` | NEP-141 faucet token for the sandbox |
| `packages/sdk` | `<pay-button>` and the JS client, built to `pay.js` |
| `packages/intents-adapter` | 1Click adapter (real), mock adapter (local) |
| `packages/chain` | NEAR client and receipt-key signing (isomorphic) |
| `packages/core` | Sessions, sellers, receipts, refund assistant, settlement logic, webhooks, email |
| `packages/db` | Prisma schema (SQLite) |
| `packages/landing` | The Zap landing page (React). Served at `/` by `apps/web` and by `apps/site` |
| `apps/web` | Landing page, checkout, receipt, verify, shop, dashboard, API |
| `apps/site` | The same landing page as a static site (for Vercel). Loads `pay.js` and live data from `NEXT_PUBLIC_APP_URL` |
| `services/settlement` | The worker: the only process with the executor key |
| `examples/seller-site` | A plain HTML shop that uses only the two lines |

Design decisions and deviations from the spec are recorded in [DECISIONS.md](DECISIONS.md).

## Trust assumptions (stated plainly)

- **The executor attributes payments to orders.** 1Click delivers USDC with a plain transfer that carries no order id, so the executor calls `mint_receipt`. The contract only credits USDC it holds and has not assigned to another receipt. Attribution is shown publicly on `/verify`.
- **The executor passes refund deposit addresses.** It can only refund requests that are already approved, never more than what is unreleased, and within the seller's daily cap. Each refund's 1Click quote id is logged on chain and checked on `/verify`.
- **Operator-registered sellers trust the operator** for refund decisions made through the dashboard, which our relayer signs on their behalf. A seller can take over their own registration by calling `register_merchant` from their own account.
- **Unaudited prototype.** Payments are capped per receipt (default $50 on mainnet). The owner can pause new payments and releases; refunds keep working while paused.

## Planned

- Sellers signing settings and decisions with their own wallet (wallet selector)
- Image upload and analysis in the refund chat (today only the file name is recorded)
- Payouts to the seller's preferred chain
- Settlement worker inside a TEE (OutLayer) with attestations
- Keeper-triggered releases
- WooCommerce, Shopify and MCP integrations
