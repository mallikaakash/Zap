# SuperSaaaS: a demo SaaS that takes payments with Zap

A small, ordinary SaaS pricing page (Free and Pro) for the Zap shop **Violina** (`aakashsaasowner.near`). The only Zap code is the two lines copied from the dashboard, marked in `index.html`. Everything else (the thank-you page, the webhook check, the orders log) is the shop's own code, which is what a real seller would have.

What the demo shows:

1. The customer clicks **Upgrade to Pro** and pays in any coin. The Zap checkout opens in a modal.
2. The page gets a `zap-paid` event and moves to `thanks.html`, which says **"Waiting for the signed webhook…"**. The browser event is only a UI hint.
3. Zap's server POSTs a **signed webhook** to this shop's server (`server.js`). The server checks the signature, that the `productId` is one it sells, and that `amount >= expectedAmount`.
4. Only then does the thank-you page turn green ("Payment confirmed by signed webhook · Pro is unlocked") and the event appears on `/orders.html`.

> **Real money.** The snippet points at the live Zap server on NEAR mainnet. A test purchase costs the price plus about 1% in swap fees, plus gas, paid from your own wallet.

## What you need

| | |
| --- | --- |
| Node 18 or newer | to run `server.js` (no `npm install`) |
| `cloudflared` | `brew install cloudflared`. Free; **no Cloudflare account needed** for a quick tunnel |
| Zap dashboard link | the private link from when you created the shop |
| MetaMask with USDT on Polygon | the price + ~2%, and ~0.1 POL for gas |

## Setup (once, about 10 minutes)

**1. Product price.** In the dashboard, **Your button**, the product must cost at least the shop's minimum order (Settings → Minimum order, default $1.00) and at least what 1Click can route for the coin the buyer picks (just over $0.01 from Polygon USDT, about $0.15 from Base USDC, more from Ethereum or Bitcoin). $1 works from every popular coin. Products can't be edited: remove and add again if needed, then put the new product-id in **two places**: the `<pay-button>` in `index.html` and `PRODUCTS` at the top of `server.js`.

**2. Start the shop** (terminal 1):

```bash
cd examples/demo-store
export ZAP_WEBHOOK_SECRET='paste it here'   # dashboard → Notifications → Signing secret
node server.js                               # → http://localhost:4000
```

**3. Open a tunnel** (terminal 2). Zap's server is on the internet and your laptop is not, so it cannot reach `localhost` by itself. A quick tunnel gives your laptop a temporary public `https://` address. A real shop's site is already public, so this is only needed for local testing (Stripe ships `stripe listen` for the same reason).

```bash
cloudflared tunnel --url http://localhost:4000
```

It prints something like `https://random-words.trycloudflare.com`. Leave it running. The address changes every time you restart it.

**4. Point Zap at it.** Dashboard → **Settings** → Webhook URL:

```
https://random-words.trycloudflare.com/api/webhooks/zap
```

Save settings.

**5. Check it before spending money.** Dashboard → **Notifications** → **Send test event**. Within a few seconds:
- terminal 1 prints `[webhook] webhook.test → ok (signature ok)`,
- `http://localhost:4000/orders.html` shows a `webhook.test` row,
- the dashboard's delivery list shows **delivered**.

If it shows **failed**, the tunnel address or path is wrong. If terminal 1 prints "rejected: bad … signature", the secret is wrong (copy it again).

**6. Private dry run.** Do one real purchase before filming (below). If MetaMask does not appear inside the checkout, add `display="redirect"` to the `<pay-button>` tag to open the checkout as a full page instead.

## The demo (about 2 minutes)

1. **Dashboard → Your button**: pick SuperSaaaS Pro, show the preview (it can't take payments), press **Copy prompt for your AI**.
2. Paste the prompt into Claude Code or Cursor in this folder: it adds the two lines and the webhook endpoint. (Or show that they are already here.)
3. Open **http://localhost:4000** → **Upgrade to Pro** → **USDT · Polygon** → **Use MetaMask** → **Continue** → **Pay with MetaMask**.
4. About 30 to 60 seconds later the thank-you page flips from "waiting" to **confirmed by signed webhook**, and the order appears on **/orders.html**.
5. **Dashboard → Orders**: the payment is held in escrow for the refund window → **Verify on chain**.
6. Optional: open the receipt link from the checkout, request a refund, and show the USDT coming back to MetaMask on Polygon.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The pricing page, with the two Zap lines marked |
| `thanks.html` | Waits for the verified webhook before unlocking Pro |
| `orders.html` | Every webhook the server verified, and what it decided |
| `server.js` | Serves the pages and verifies `x-uc-signature`, the product and the amount (no dependencies) |
