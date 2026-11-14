# Pixel & Pine: a demo store that takes payments with Zap

A small, ordinary shop website: two products, a thank-you page and an orders page. The only Zap code is the two lines copied from the dashboard (marked in `index.html`). Everything else is the shop's own code, which is what a real seller would have.

It shows the full real-world flow:

1. The customer clicks **Buy now** and pays in any coin (the Zap checkout opens in a modal).
2. The page gets a `zap-paid` event and moves to `thanks.html`. That event is only a UI hint.
3. Zap's server sends a **signed webhook** to this shop's server (`server.js`), which checks the signature.
4. Only then does the thank-you page say "confirmed" and show the download, and the order appears on `/orders.html`.

> **Real money.** The snippet points at the live Zap server on NEAR mainnet. Each test purchase costs the price (about $1) plus network fees, paid from your own wallet.

## Run it

Requires Node 18 or newer. No `npm install` needed.

```bash
cd examples/demo-store
ZAP_WEBHOOK_SECRET=<your signing secret> node server.js
# → http://localhost:4000
```

The signing secret is in your Zap dashboard, **Notifications** tab.

Opening `http://localhost:4000` is enough to see the button and pay. Steps 3 and 4 need the webhook, which needs one more thing:

## Let Zap's server reach your laptop (only for local testing)

Zap's server is on the internet and your laptop is not, so it cannot deliver the webhook to `localhost`. A free tunnel gives your laptop a temporary public address. (A real shop's site is already public, so this step is only for testing locally; Stripe has the same limitation and ships `stripe listen` for it.)

```bash
brew install cloudflared             # or see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
cloudflared tunnel --url http://localhost:4000
```

It prints an address like `https://random-words.trycloudflare.com`. In the Zap dashboard, **Settings → Webhook URL**, enter:

```
https://random-words.trycloudflare.com/webhooks/zap
```

and save. The address changes every time you restart the tunnel.

## Use your own products

The buttons in `index.html` use a custom price (`amount="1"`) so the page works straight away. For a real shop, use saved products instead, so the price comes from Zap's server and nobody can edit it in the page:

1. Dashboard → **Your button** → **Add a product** (for example "Starter icon pack", $1).
2. Keep **HTML** selected and press **Copy** on the snippet.
3. Replace the `<pay-button …>` line in `index.html` with the copied one.
4. Optional: Settings → **Only accept my saved products**, so custom-price buttons are refused.

## If MetaMask does not appear in the checkout

Some wallet extensions do not inject into embedded checkouts. Add `display="redirect"` to the `<pay-button>` tag to open the checkout as a full page instead.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The shop's product page, with the two Zap lines marked |
| `thanks.html` | Waits for the verified webhook before "delivering" |
| `orders.html` | Every webhook event the server verified |
| `server.js` | Serves the pages and verifies `x-uc-signature` (about 60 lines, no dependencies) |
