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
