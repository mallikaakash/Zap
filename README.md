# Universal Checkout

A business pastes a checkout button on its site. The customer pays with any coin on any chain. NEAR Intents settles that payment into USDC, and a receipt NFT holds the USDC until the refund window ends. A refund goes back to the same coin and chain. Cancelling a prepaid pass returns the periods that have not started.

Built at NEAR HACKATHON 2026. Hackathon prototype, unaudited, not a licensed money service. Funds are held by a public contract, not by a company.

This file is the way to try the project. `pnpm demo` needs no API keys, no wallet, and no `.env`.

## Try it

Needs Node 22+ and pnpm. The first run downloads a local NEAR sandbox (about 60 MB). Rust is not required.

```bash
pnpm install
pnpm demo
```

The terminal prints four URLs when the app is up. Use those URLs. Then:

1. Do: open **Demo checkout**. Click a plan, pick any coin, enter a refund address, and press **Simulate payment**.
   See: a receipt. The amount is held. The page is marked **Simulated**.
2. Do: on that receipt, press **Request refund** and write that a feature is not working. When the assistant asks for a screenshot, attach any image.
   See: the assistant approves the refund.
3. Do: open the **Merchant dashboard** URL from the terminal and press **+1 min**.
   See: the refund completes and the held amount drops.
4. Do: buy the prepaid plan. On its receipt, claim it, transfer it, then cancel it.
   See: periods that have not started come back. Periods already due stay with the business.
5. Do: open **Dev inbox**.
   See: the emails the app would have sent.

`pnpm test` runs the TypeScript tests. Stop the demo with Ctrl+C.

The demo shop is Tallyfox. It has a one-time plan, a prepaid pass, and a milestone project. Swaps are simulated. The receipt contract on the sandbox is the real contract.

## What NEAR does

NEAR Intents quotes a swap that delivers USDC to the receipt contract. The contract mints a NEP-171 receipt and holds that USDC. When the refund window ends, a release pays the business. An approved refund sends the USDC back out through Intents to the customer's original coin and chain. The customer's browser creates the receipt key. Only the public key is stored on chain. The server relays signed actions and pays the gas.

On the demo, a mock adapter stands in for Intents. The escrow rules, the refund state machine, and the receipt NFT are the contract's.

## What a business adds

```html
<script src="https://YOUR-HOST/pay.js" defer></script>
<pay-button merchant="your-business.near" product-id="PRODUCT_ID" product="Pro plan"></pay-button>
```

`examples/seller-site/index.html` is a plain page with those two lines. The button opens a hosted checkout. It is not proof of payment. The business confirms `payment.succeeded` from the signed webhook (`X-UC-Signature`).

The dashboard link printed by `pnpm demo` is the login for that run. It contains a secret. There is no wallet to connect.

## Live payments

Live mode uses NEAR mainnet, real USDC, and real NEAR Intents. NEAR Intents has no testnet. The demo above does not touch mainnet. Deploying or paying on mainnet is a human action, documented in [docs/GO-LIVE.md](docs/GO-LIVE.md). A screening run should stop at `pnpm demo`.

## Trust

- Intents delivers USDC with no order id. The settlement worker attributes the deposit and calls `mint_receipt`. The contract will not assign the same USDC to two receipts. `/verify/:id` shows that attribution.
- The worker can send a refund only after the contract has approved it, only for the approved amount, and only inside the daily cap. `/verify/:id` compares the quoted recipient with the refund address on the receipt.
- For a shop registered by the operator, refund approvals in the dashboard are signed by the app's relayer. A merchant can take over by calling `register_merchant` from their own account.
- The contract is unaudited. Mainnet payments are capped per receipt. The owner can pause new payments and releases. Refunds still run while paused.

## Repo

| Path | What |
|---|---|
| `contracts/receipts` | Receipt contract: escrow, refunds, receipt-key signatures. Interface: [contracts/INTERFACE.md](contracts/INTERFACE.md). |
| `contracts/mock-usdc` | Faucet token for the sandbox |
| `packages/sdk` | `<pay-button>`, built to `pay.js` |
| `packages/intents-adapter` | Real 1Click adapter and the local mock |
| `packages/chain` | NEAR client and receipt-key signing |
| `packages/core` | Sessions, merchants, receipts, refund assistant, settlement, webhooks, email |
| `packages/db` | Prisma schema (SQLite) |
| `apps/web` | Checkout, receipt, verify, shop, dashboard, API |
| `services/settlement` | Worker. In live mode it is the only process with the executor key |
| `examples/seller-site` | A static page that embeds the button |

## Planned

- The merchant signs settings and refund decisions with their own wallet
- The refund chat uploads and reads the image. Today only the file name is stored
- Payouts on the merchant's own chain
- The settlement worker inside a TEE
- WooCommerce, Shopify, and MCP integrations
