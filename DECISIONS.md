# Decisions

Choices made while building that are not spelled out in `SPEC.md`, or that deviate from it.

## Repo and tooling
- **Node 22+, pnpm 10.** The starter's `.nvmrc` asked for 26; nothing here needs it.
- **Workspace packages export TypeScript source** (`exports: ./src/index.ts`). Consumers are Next.js (`transpilePackages`) and `tsx`, so `pnpm demo` needs no build step for internal packages.
- **Prebuilt contract WASM is committed** under `contracts/artifacts/`. Judges can run `pnpm demo` without a Rust toolchain. `pnpm build:contracts` rebuilds them.
- The starter `frontend/` (Vite) and `contract/` (auction template) were removed; the spec's layout replaces them.

## Receipt contract
- **One-time rotating secrets (deviation from SPEC §4).** The spec passes the raw receipt secret to `request_refund` / `cancel`. That publishes the secret on chain, after which anyone could `claim` the NFT and redirect the refund. Instead, every secret-authorised call that does not end the secret's life must supply `next_secret_hash`; the contract swaps it in. The client derives `secret_n = sha256(master || ":" || n)` from the master secret in the receipt URL fragment, where `n` is the receipt's on-chain `secret_nonce`. A used secret is worthless once its transaction lands.
- **`in_flight` accounting (addition to SPEC §4).** Outgoing USDC transfers are tracked in `in_flight` until their callback resolves. `mint_receipt` requires `balance >= allocated + in_flight + amount`, so a balance read that predates a pending release/refund cannot be double-assigned.
- **Transfers roll back on failure.** `release` and `execute_refund` restore receipt state if `ft_transfer` fails (for example, the recipient is not registered with the USDC contract).
- **`order_ref` is unique per merchant**, which makes `mint_receipt` idempotent for worker retries.
- **`request_refund` is for `OneTime` receipts; `cancel` is for `Subscription` / `Schedule`.** Cancel refunds tranches whose time has not arrived; tranches already due belong to the merchant.
- **Secret-authorised calls can be sent by anyone** (the backend relays them, since a customer may have no NEAR account).
