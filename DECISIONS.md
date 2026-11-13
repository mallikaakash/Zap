# Decisions

Choices made while building that are not spelled out in `SPEC.md`, or that deviate from it.

## Repo and tooling
- **Node 22+, pnpm 10.** The starter's `.nvmrc` asked for 26; nothing here needs it.
- **Workspace packages export TypeScript source** (`exports: ./src/index.ts`). Consumers are Next.js (`transpilePackages`) and `tsx`, so `pnpm demo` needs no build step for internal packages.
- **Prebuilt contract WASM is committed** under `contracts/artifacts/`. Judges can run `pnpm demo` without a Rust toolchain. `pnpm build:contracts` rebuilds them.
- The starter `frontend/` (Vite) and `contract/` (auction template) were removed; the spec's layout replaces them.

## Receipt contract
- **`contracts/INTERFACE.md` is the binding interface** between the contract and the TypeScript side. It follows the revised SPEC §4/§8/§9b/§9c.
- **Signature preimage.** `utf8("uc:v1|{contract}|{receipt_id}|{action}|{params}|{nonce}")`, signed as its sha256 digest with ed25519. Fields are joined with `|` and may not contain it.
- **Status is derived** from `released` / `refunded`; the refund flow lives in `request` (SPEC §9b state machine). `Rejected` is final for that receipt's customer requests; the merchant can still refund.
- **`ai_decide` escalates rather than panics** when an approval is above `auto_approve_max` or `guard_threshold`.
- **Storage.** A fixed 0.01 NEAR per receipt is charged to the merchant's prepaid `storage_balance`. USDC storage registration of payout and refund deposit accounts is done by the backend before the transfer; a transfer to an unregistered account rolls back.
- **Off-chain rules.** `customer_reply_secs`, `min_order`, refund-address rate limit (5 requests / 30 days / merchant) and blocklist are enforced by the backend, not the contract.

## Backend
- **`order_ref` on chain = `sha256("{merchantId}:{orderRef}")`.** The readable order id stays in the database.
- **Two signers, two processes.** The settlement worker alone holds the executor key (mint, `ai_decide`, `execute_refund`, release, finalize). The web app uses a separate relayer account to relay customers' signed calls, so access-key nonces never collide.
- **The AI agent's decision is computed in the web app and posted by the worker.** The web app has no executor key; the worker submits `ai_decide`, and the contract re-checks the limits.
- **Demo-custodial accounts (local sandbox, and testnet until wallet signing lands).** There are no wallets on a local sandbox, so the app creates and holds throwaway accounts for demo merchants and for customers who claim a receipt. SPEC §9c #9 (merchant signs with their own wallet) is planned for the hosted testnet build; live mode refuses custodial accounts.
- **Mock swaps use the primary path** (USDC lands in the contract, the worker calls `mint_receipt`); "Pay with USDC on NEAR" uses the `ft_transfer_call` path. Both are exercised by `pnpm demo`.
- **Refunds to USDC on NEAR skip the swap** (`quote_id = "direct-usdc"`).
- **Webhooks**: `X-UC-Signature: sha256=HMAC(secret, "{timestamp}.{body}")`, `X-UC-Timestamp`, `X-UC-Event-Id`; five-minute tolerance; retries with backoff.
- **Photos in the refund chat are recorded by file name only**; the image is not uploaded or analysed yet.
- **Demo clock.** `UC_TIME_SCALE` divides schedule delays (never in live mode) so "30 days" can be shown in a minute on the sandbox. The UI labels it.

## Product direction (agreed with the project owner, 2026-11-13)
- **Goal:** a real, Stripe/Dodo-style payment gateway that drops into any site as a widget. Sellers get paid and everyone is notified of what happens.
- **Primary user:** indie / no-code sellers (Carrd, Notion, Framer, Webflow pages). They usually have no server, so email and the dashboard matter more than webhooks; webhooks stay for developers.
- **Real money:** a hosted testnet site for judges, with swaps simulated and clearly labelled, plus a real $1–2 mainnet payment and refund run by the owner (`pnpm proof:mainnet`) with tx links in the README. NEAR Intents has no testnet, and the contract is unaudited.
- **Merchant onboarding:** the seller gives a name and a payout account; the operator registers the shop on chain, with no wallet popups. Refund approvals happen in the dashboard behind an email magic-link login. Wallet connect is planned.
- **Customer receipts:** optional email at checkout; the receipt link is emailed to the customer.
- **Email:** Resend in hosted mode; a dev inbox page in local mode.
- **Remaining scope:** WooCommerce plugin and the real NEAR AI model stay in. MCP server and Shopify are cut; everything else goes to polish.
- **Video story:** pay with any coin → item arrives broken → the assistant asks for a photo → it approves → the money returns on the original chain → a pass changes hands → "works on any site".

## Real-money pivot (agreed 2026-11-13; supersedes "Real money" and "Remaining scope" above)
- **The demo is a real product on NEAR mainnet** with real NEAR Intents. A testnet contract cannot hold mainnet USDC, so the receipt contract, executor and payouts are all on mainnet. `local` mode stays for development and tests.
- **Accounts:** operator `aakash7777.near`, contract `checkout.aakash7777.near`, executor and relayer as subaccounts. The human deploys and funds them; Claude never holds mainnet keys or sends transactions.
- **Customer wallet for the demo:** MetaMask paying with Polygon USDT. Any 1Click-supported coin works at checkout; EVM coins get a one-click MetaMask button, others use the address/QR.
- **HTTPS:** no domain, so `<ip>.sslip.io` with Caddy. HTTPS is required for in-browser receipt keys and MetaMask.
- **Database:** SQLite file on the VM's disk in live mode (persistent, backed up). Postgres only if we move to multiple servers.
- **Demo timing is real time:** products carry their own refund window and subscription interval (minutes for the demo).
- **"Collect payout" button** in the dashboard: anyone may call `release`; the contract enforces the rules.
- **Cut:** WooCommerce, MCP server, Shopify, CronCat. The trust extra (payout changes signed by the seller) is out of scope.

## Contract details for mainnet (2026-11-13)
- **Seller storage:** a receipt costs about 1,060–1,300 bytes, so the contract charges 0.014 NEAR per receipt from the seller's prepaid `storage_balance`. The operator's executor prepays 0.15 NEAR per new seller and tops sellers up automatically when fewer than 4 receipts are left.
- **`self_managed` sellers:** a seller that registered itself with `register_merchant` cannot be changed by `register_merchant_for`. This stops the executor key from redirecting such a seller's payouts.
- **Rejected direct payments** count as USDC that left the contract (`settled_total`) in the balance checks for `mint_receipt` and `withdraw_unassigned`. The worst case is a spurious "insufficient" error, followed by a retry.
- **No upgrade in place:** the state layout changed, so contracts from older builds cannot be upgraded; deploy to a fresh account.
- **Per-payment cap:** `max_receipt_amount` defaults to $1,000; the deploy script sets $50.
