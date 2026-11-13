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

## Landing page (2026-11-13)
- **Design source:** the Claude Design canvas "Zap Payments — Hero" (three artboards). The landing page uses the Zap name and look: ink #111111, one pink accent #FF2D87, Inter / Space Grotesk / JetBrains Mono. The other app pages keep their current style for now.
- **One component, two hosts:** `packages/landing` is rendered at `/` by `apps/web` (so the VM, Cloud Run and `pnpm demo` all serve it) and by `apps/site`, a static export for Vercel. The Vercel copy loads the real `pay.js` from the checkout app, so it is also a live "works on any site" example. The app's API already sends `Access-Control-Allow-Origin: *`.
- **Self-hosted fonts** (`@fontsource-variable/*`) instead of Google Fonts or `next/font/google`, so builds and the demo work offline.
- **Copy kept honest against the code:** the events are `uc:paid` / `uc:closed`; the refund assistant asks for a photo but does not analyse it (photo analysis stays under "What's next"); the dashboard, receipt and refund numbers on the page are labelled examples. The real "Try it: pay $1" button appears only once a shop exists, with a note saying whether it is real money (live) or simulated.
- **Interactive demos are pure functions** (`flow.ts`, `protections.ts`) with tests; the protections demo mirrors the contract rules (guard threshold escalates, veto window, daily cap, silence-means-approval deadline).
- **Hero rebuild (2026-11-13):** the phone stands on the scene's floor and is the shopper's wallet: the coin is born on its Pay button (pink tap ring), crosses the bridge, lands in the safe and reaches the shop. The camera was flipped (`rotateY(45deg)`) so the path rises to the top-right. Pink appears only where money moves (USDC in the headline, the coin's tag, the safe's door, the tap ring). The only ambient motion is the safe's dial; everything else moves when the story advances, with a long hold on the open refund window. Legend cards scrub the story; the coin picker recolours the route, the coin and the captions. The poster scales to fit the window's width and height.
- **No nested 3D on the phone:** a `preserve-3d` phone with thickness layers, or `scale` and `perspective` on one element, made Chromium hit-test the tilted screen too narrow (the right-hand coin buttons could not be clicked). The phone is one flat tilted plane; its thickness is a box-shadow edge.
- **Real data on the page:** `GET /api/receipts/latest` (public; receipts are already public at `/verify/<id>`) lets the Verify section show the newest real receipt with live attribution, refund destination and solvency, falling back to a labelled example. The asset count comes from `/api/tokens` at view time, and the `pay.js` size is gzipped at render time from the file the app serves. The contract excerpt beside Seller protections is verbatim, with a test that checks it line by line against `contracts/receipts/src/refunds.rs`.
- **Dark mode** follows `prefers-color-scheme`; the phone and laptop "screenshots" stay light. Code blocks turn font ligatures off so `=>`, `>=` and `<=` read as typed.
- **Share card:** `og.png` (1200×630) is a still of the hero (`/?still=7`), served by both hosts.

## Fixes from the Cloud Run audit (2026-11-13)
- **`/api/receipts/[id]/target` was never committed.** The route existed locally, but `.gitignore` had `**/target/` (for Rust build output), which also matched the API folder named `target`, so "Change refund address" got a 404 on every deploy. The rule is now `contracts/target/` and `contracts/**/target/`, and the route is in git. Checked on the sandbox: a signed change is accepted and lands on chain; a replayed signature is rejected.
- **Live claims need an existing account.** In live mode `prepareClaimAccount` no longer falls through to demo-account creation (which threw and showed "Something went wrong"). It requires a full account id that exists on the network and says what to do otherwise. The receipt page says so up front, and that after claiming, the account's own wallet is needed.
- **Landing hides "Try the demo shop"** until the server has a shop, so a fresh deploy doesn't link to an empty `/shop`.
- **One look across the app.** The app pages (dashboard, shop, checkout, receipt, verify) now use the Zap tokens from the landing page: ink for actions, pink only for the brand mark and focus rings, warm off-white canvas, Inter / Space Grotesk / JetBrains Mono (self-hosted), pill buttons and the Zap logo. Links are ink with a pink underline, since an ink link on ink text would disappear. The app pages stay light-only; the landing page has dark mode.
- **`<pay-button>` defaults to ink (#111111)** instead of indigo, matching the brand and the landing page's styler. Sellers can still set any `color`.
- **`/shop` states:** a loading skeleton, a 15-second timeout with "Try again", "No shop is set up on this server yet" linking to the dashboard, and "no products yet". No more endless "Loading…".
- **Invalid `/pay` links** get a small self-contained page in the Zap look (still HTTP 400) instead of plain text.
- **`GET /api/health`:** database check plus mode and network; 200 or 503. No chain calls, so it is cheap.
- **No auto-seeded demo shop on deploy.** In live mode that would sign mainnet transactions with the executor key on every fresh revision. Instead the database now survives deploys (below), and empty states explain what to do.
- **SQLite persistence on Cloud Run with Litestream.** The image includes Litestream; `scripts/cloudrun-entrypoint.sh` restores `.uc/live.db` from `LITESTREAM_REPLICA_URL` on start and streams changes while running. Without the variable nothing changes. Verified locally with Docker and a file replica: a row written in one container was restored into a brand-new one. Litestream's `-exec` does not use a shell, so the entrypoint hands it a script. Deploys now use `--max-instances=1` (one SQLite writer; before, up to 3 instances each had their own database) and `--no-cpu-throttling` (the settlement worker and replication run between requests). Bucket setup: docs/gcp-cloud-run.md.

## Positioning: checkout for SaaS and online businesses (2026-11-13)
- **Wording.** Zap is presented as crypto checkout for SaaS and online businesses (in the spirit of Stripe Checkout or Dodo Payments), not a shop widget. Customer-facing copy says *business* and *customer*; developer-facing copy says *merchant*. The example business is the fictional **Acme Analytics** (Pro plan, prepaid Team plan, onboarding milestones), on the landing page and in the `pnpm demo` seed (merchant id `acme-analytics.test.near`). Internal identifiers and the `/shop` route are unchanged.
- **Refund stories match the real assistant.** The landing page's approve / deny / escalate chats follow what `refund-agent.ts` actually does ("not working" asks for a screenshot then approves; "don't need it" is a change of mind and is denied; a valid claim above the auto-approve limit escalates). Tests in `packages/core/test` pin all three. The assistant's two questions were reworded to fit software as well as goods; its categories and rules are unchanged.
- **Top line.** Live shows "Live on NEAR mainnet · real money, capped at $50 a payment"; the local demo shows "Local demo · simulated, no real money moves". "Hackathon prototype" moved out of the top line; the footer keeps the unaudited-prototype disclaimer. The developers section's `pnpm demo` terminal is tagged "LOCAL DEMO" (it was a hard-coded "SIMULATED" that also showed on live).
- **Sandbox-only scripts are pinned to the sandbox.** Config loads the repo-root `.env` before `.uc/runtime.json`, so on a machine with a live `.env` the e2e script picked up live settings (it made one non-dry 1Click quote before stopping; nothing was signed or paid). `scripts/sandbox-env.ts`, imported first by `scripts/e2e.ts`, now pins every setting to `.uc/runtime.json`, blanks email/AI keys and refuses to run unless it points at the local sandbox.

