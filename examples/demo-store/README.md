# SuperSaaaS: a demo SaaS shop, before Zap

A small, ordinary SaaS pricing page (Free and Pro) with **no payments yet**. The demo is adding Zap to it the way a real seller would: paste the prompt from the Zap dashboard into a coding agent, and the agent adds the pay button and the signed-webhook endpoint.

What is here before the prompt:

| File | What it is |
| --- | --- |
| `index.html` | The pricing page. The Pro card has a marked spot for the checkout button. |
| `server.js` | Serves the pages and an orders list (`/api/orders`). No webhook endpoint yet. |
| `orders.html` | Shows the orders list. Empty until payments are recorded. |
| `thanks.html` | A thank-you page that waits for a confirmed order (`/thanks.html?receipt=<id>`). |

> **Real money.** The Zap server is on NEAR mainnet. A test purchase costs the price plus about 1% in swap fees, plus gas, from your own wallet.

## Before filming (once)

1. **Your shop.** Log in at `https://zap-2lcs3sivbq-uc.a.run.app/login`. Under **Your button**, add a product, e.g. "SuperSaaaS Pro", one-time, **$1** ($1 works from every popular coin).
2. **Start the shop** (terminal 1): `cd examples/demo-store && node server.js` → http://localhost:4000
3. **Open a tunnel** (terminal 2) so Zap's server can reach your laptop: `cloudflared tunnel --url http://localhost:4000`. It prints `https://<random>.trycloudflare.com`. Keep it running; the address changes on every restart.
4. **Webhook URL.** Dashboard → Settings → Webhook URL: `https://<random>.trycloudflare.com/api/webhooks/zap` → Save settings.

## The demo

1. **Dashboard → Your button**: pick SuperSaaaS Pro, show the preview (it can't take payments), press **Copy prompt for your AI**.
2. Open this folder in Claude Code (or Cursor) and paste the prompt. Add one line: *"This is a plain HTML + Node shop: put the button in the Pro card in index.html, add the webhook endpoint to server.js and record verified payments in its `events` list (shape in the comment), and send the customer to /thanks.html?receipt=<receiptId> after zap-paid."*
3. The agent asks for `ZAP_WEBHOOK_SECRET`. Dashboard → Notifications → copy the signing secret, then restart the shop with it: `ZAP_WEBHOOK_SECRET='…' node server.js`.
4. Dashboard → Notifications → **Send test event** → it should show **delivered**, and the shop's terminal should log it.
5. Open http://localhost:4000 → **Upgrade to Pro** → **USDT · Polygon** → **Use MetaMask** → **Continue** → **Pay with MetaMask**. About 30 to 60 seconds later the thank-you page confirms the order, and it appears on /orders.html.
6. **Dashboard → Orders**: the payment is held in escrow for the refund window → **Verify on chain**.

## If the agent fumbles on camera

The finished integration is in git. Restore it with:

```bash
git checkout 553d203 -- examples/demo-store
```

Then change the `merchant` and `product-id` in `index.html` and the `PRODUCTS` entry in `server.js` to your shop and product, and start it with `ZAP_WEBHOOK_SECRET='…' node server.js`.
