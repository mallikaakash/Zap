# @uc/sdk — `<pay-button>` and the Universal Checkout browser client

Drop-in checkout button (custom element, Shadow DOM, no framework, zero runtime
dependencies) plus a tiny JS client. Money is always **integer USDC minor units
(6 dp) as strings** on the wire; the SDK converts USD decimals with string/BigInt
math, never floats.

```html
<script src="https://<host>/pay.js" defer></script>
<pay-button merchant="shop.testnet" amount="49" product="Ebook" mode="one-time"
            label="Pay any way" color="#4F46E5" radius="12"></pay-button>
```

> The button is a convenience, never proof of payment. Merchants must confirm
> payment server-side from the signed webhook (`X-UC-Signature`).

## Develop

```sh
pnpm --filter @uc/sdk test        # vitest + happy-dom
pnpm --filter @uc/sdk typecheck
pnpm --filter @uc/sdk build       # -> dist/pay.js (single minified IIFE)
open packages/sdk/demo.html       # after a build; backend is mocked in the page
```

- `dist/pay.js` — self-registering script build. Defines `<pay-button>` and sets
  `window.UniversalCheckout`. The host app serves it at `/pay.js`.
- `src/index.ts` — source-first module entry (`import { usdToMinor } from "@uc/sdk"`).
  Importing it registers the element in the browser and is a no-op under SSR;
  loading it twice is safe.

## Attributes

All attributes are reactive: changing one updates the button immediately.

| Attribute | Values | Notes |
|---|---|---|
| `merchant` | string, **required** | Merchant id, e.g. `shop.testnet`. Sent as `merchantId`. |
| `amount` | USD decimal, e.g. `49`, `49.99` | Required for `one-time`. Optional for the other modes; if given it must equal the computed total. Max 6 decimals, must be > 0. |
| `mode` | `one-time` (default) \| `subscription` \| `schedule` | |
| `months` | integer 1–120 | `subscription` only. |
| `monthly` | USD decimal | `subscription` only. Total = `months × monthly`. |
| `tranches` | JSON array of `{ "afterDays": number, "amount": "USD decimal" }` | `schedule` only. Total = sum. Sorted by `afterDays` before sending. |
| `product` | string | Optional display name. |
| `order-ref` | string | Your order id. Generated per click (`uc_<32 hex>`) when absent. |
| `metadata` | JSON object string | Passed through to the session. |
| `api` | URL | Base URL of the Universal Checkout host. Default: the origin `pay.js` was loaded from (`document.currentScript`), else `location.origin`. |
| `display` | `modal` (default) \| `redirect` | `redirect` navigates to the checkout URL instead of opening the modal. |
| `label` | string | Default `Pay any way`. |
| `color` | any CSS colour | Button background. With a hex colour and no `text-color`, the text colour is picked automatically for contrast. |
| `text-color` | any CSS colour | |
| `radius` | number (px) or CSS length | |
| `size` | `sm` \| `md` (default) \| `lg` | |
| `icon` | `lock` (default) \| `coins` \| `none` | |
| `disabled` | boolean | |

Invalid configuration renders a disabled button (the reason is in its tooltip and
in `element.error`) and logs `[pay-button] invalid configuration: …` once.

Properties / methods: `element.pay()` (same as a click, returns a promise),
`element.close()`, `element.state` (`idle | loading | open | success | error`),
`element.error`, `element.config`.

## CSS custom properties

Set on the element or any ancestor. The `color`, `text-color` and `radius`
attributes win over the matching variable.

| Variable | Default |
|---|---|
| `--uc-color` | `#4F46E5` |
| `--uc-text-color` | `#fff` |
| `--uc-radius` | `12px` |
| `--uc-font` | system UI stack |
| `--uc-font-size` | `15px` (`13px` sm, `17px` lg) |
| `--uc-font-weight` | `600` |
| `--uc-height` | `44px` (`36px` sm, `54px` lg) — minimum height |
| `--uc-padding` | `0 20px` |
| `--uc-border` | `0` |
| `--uc-shadow`, `--uc-shadow-hover` | soft tinted shadow |
| `--uc-focus-color` | `--uc-color` |
| `--uc-error-color` | `#dc2626` |

Modal (read from the document, i.e. set them on `:root`/`body`):
`--uc-backdrop`, `--uc-modal-width` (460px), `--uc-modal-height` (720px),
`--uc-modal-radius` (20px), `--uc-modal-bg`, `--uc-z-index` (2147483000), `--uc-font`.

Shadow parts: `pay-button::part(button | icon | label | error)`; modal:
`uc-checkout-modal::part(backdrop | dialog | header)`. The host is `inline-block`;
give it a width (`pay-button { width: 100% }`) for a full-width button.

## DOM events

All are `CustomEvent`s dispatched on the `<pay-button>`, `bubbles: true, composed: true`.

| Event | `detail` | When |
|---|---|---|
| `uc:paid` | `{ sessionId, receiptId, receiptUrl }` | The checkout page reported payment. The modal stays open so the customer sees the receipt. |
| `uc:closed` | `{ sessionId, paid: boolean }` | Modal closed (close button, Esc, backdrop, or `uc:close` message). |
| `uc:error` | `{ code, message, status? }` | Session creation failed. `code`: `network` \| `http` \| `bad_response` \| `invalid_config`. The button shows a short inline error and re-enables. |

```js
document.addEventListener("uc:paid", (e) => console.log("paid", e.detail.receiptUrl));
```

## Session request (what the backend must accept)

`POST {api}/api/sessions`, `Content-Type: application/json`, no credentials.
Because it is a cross-origin JSON POST from merchant sites, the route must answer
the CORS preflight (`OPTIONS`, `Access-Control-Allow-Origin: *`,
`Access-Control-Allow-Headers: content-type`).

```ts
{
  merchantId: string;                 // `merchant`
  amountUsd: string;                  // TOTAL in USDC minor units (6 dp), e.g. "49000000"
  kind: "OneTime" | "Subscription" | "Schedule";
  schedule?: { afterSecs: number; amount: string /* minor units */ }[];
  orderRef: string;                   // `order-ref` or generated "uc_<32 hex>"
  product?: string;
  metadata?: object;
}
```

Optional keys are **omitted** (never `null`). `schedule` is absent for `OneTime`.

- **OneTime** — `amount="49"` → `{"merchantId":"shop.testnet","amountUsd":"49000000","kind":"OneTime","orderRef":"…","product":"Ebook"}`
- **Subscription** — `months="3" monthly="9.99"` → `amountUsd: "29970000"`, `schedule` = `months` items of `monthly`, item *i* at `afterSecs = i × 2592000` (30 days), first at `0`.
- **Schedule** — `tranches='[{"afterDays":0,"amount":"20"},{"afterDays":30,"amount":"29"}]'` → `amountUsd: "49000000"`, `schedule: [{"afterSecs":0,"amount":"20000000"},{"afterSecs":2592000,"amount":"29000000"}]` (`afterSecs = round(afterDays × 86400)`, ascending).

`sum(schedule[].amount) === amountUsd` always holds.

Response (2xx): `{ "sessionId": string, "checkoutUrl": string }`. `checkoutUrl` must be
http(s); a relative URL is resolved against `api`. On a non-2xx status, a JSON body
with `error` or `message` (string) is surfaced in the `uc:error` message.

## Hosted checkout ↔ parent protocol (postMessage)

The SDK loads `checkoutUrl` with `embed=1` added to the query (existing query and
fragment preserved) in an iframe. The checkout page talks to the parent with:

```js
window.parent.postMessage({
  source: "universal-checkout",                       // required
  type: "uc:paid" | "uc:close" | "uc:resize",         // required
  sessionId,                                          // if present must match the session
  receiptId, receiptUrl,                              // uc:paid
  height,                                             // uc:resize — content height in px
}, "*");
```

The SDK only accepts a message when `event.origin` equals the origin of
`checkoutUrl`, `data.source === "universal-checkout"`, the message comes from the
checkout iframe's window, and `sessionId` (when sent) matches.

- `uc:paid` → `uc:paid` DOM event (first one only), button shows "Paid"; modal stays open.
- `uc:close` → closes the modal → `uc:closed`.
- `uc:resize` → dialog height becomes `height` + header (clamped to the viewport; ignored on
  small screens where the modal is full screen). Send the content's height, not
  `documentElement.scrollHeight` (which is never smaller than the iframe).

Esc pressed while focus is inside the iframe never reaches the parent page, so the
checkout page should send `uc:close` on Esc itself when `embed=1`.

## JS client

Exported from `@uc/sdk` and available as `window.UniversalCheckout` after `pay.js`:

```ts
usdToMinor("49.99")            // "49990000"  (throws UcError on junk / >6 dp / negatives)
minorToUsd("49990000")         // "49.99"     ("49000000" -> "49", "49500000" -> "49.50")
buildSessionBody(config)       // validated request body (see above), no network
await createSession({ api, merchant, amount, product, mode, months, monthly,
                      tranches, orderRef, metadata })
                               // -> { sessionId, checkoutUrl, request }
openCheckout(checkoutUrl, { display, sessionId, onPaid, onClose, accent, title })
                               // -> { display, paid, close() }
checkoutLink({ api, merchant, amount, product, mode, months, monthly, tranches,
               orderRef, metadata })
                               // -> "{api}/pay?merchant=…&amount=…&product=…&mode=…"
```

`checkoutLink` is for shareable links and QR codes. Query parameters:
`merchant`, `amount` (USD decimal, as given), `product`, `mode`, and — when relevant —
`months`, `monthly`, `tranches` (JSON), `orderRef`, `metadata` (JSON). The hosted
`/pay` route can pass them straight to `buildSessionBody()`, create the session
and redirect to its checkout URL.

Errors are `UcError` with `code` (`invalid_config | network | http | bad_response`)
and, for `http`, `status`.

## Behaviour notes

- Modal: appended to `document.body` as `<uc-checkout-modal>` with its own shadow
  root; backdrop, close button, Esc, focus moved in and restored, rest of the page
  made `inert`, page scroll locked, full screen below 520px, transitions disabled
  under `prefers-reduced-motion`.
- If the modal cannot be created the SDK falls back to `location.assign(checkoutUrl)`.
  A checkout page that forbids framing (CSP `frame-ancestors` / `X-Frame-Options`)
  cannot be detected from the parent — use `display="redirect"` in that case.
