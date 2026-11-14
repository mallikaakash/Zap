import { getConfig } from "@uc/core";
import { integrationSteps, PLATFORMS, WEBHOOK_VERIFY_NODE } from "@/lib/integrate";

export const dynamic = "force-dynamic";

/** The whole integration contract as plain text, for coding agents (https://llmstxt.org). */
export function GET() {
  const origin = getConfig().publicUrl;
  const attrs = 'merchant="YOUR_MERCHANT_ID" product-id="PRODUCT_ID"';
  const platforms = PLATFORMS.map(({ id, label }) => {
    const steps = integrationSteps(id, origin, attrs)
      .map((s, i, all) => `${all.length > 1 ? `${i + 1}. ` : ""}${s.title}${s.file ? ` (${s.file})` : ""}\n\n\`\`\`\n${s.code}\n\`\`\``)
      .join("\n\n");
    return `### ${label}\n\n${steps}`;
  }).join("\n\n");

  const body = `# Zap checkout

> A pay button for any website. Customers pay in any coin on any chain (swapped by NEAR Intents); the shop receives USDC on NEAR. Each payment is held in escrow by a receipt contract until the refund window ends.

Integration is a script tag plus one custom element per product. The merchant id and product ids come from the merchant's dashboard (${origin}/dashboard), tab "Your button". Saved products set their price, refund window and plan on the server, so the page cannot change them.

## Add the button

${platforms}

## <pay-button> attributes

- merchant (required): the shop's merchant id, e.g. "yourshop.near".
- product-id: a saved product. Price, kind and refund window come from the server. Preferred.
- amount + product: an ad-hoc USD price and name instead of product-id (e.g. amount="49"). Editable by the buyer in the page; shops can refuse these with the "Only accept my saved products" setting.
- mode="subscription" months="3" monthly="29": a prepaid plan without a saved product.
- order-ref: your own order id, returned in webhooks. metadata: a JSON object, returned in webhooks.
- label, color, text-color, radius, size (sm|md|lg), icon (lock|coins|none): appearance.
- display="redirect": open the checkout as a full page instead of a modal.
- disabled: render but do not open checkout. preview: render, and explain on click that it is a preview.

## Events (bubble from the element)

- zap-paid { sessionId, receiptId, receiptUrl }: the customer paid. For UI only (show a thank-you); it is not proof of payment.
- zap-closed { sessionId, paid }: the checkout was closed.
- zap-error { code, message }: the checkout could not start.
The same events are also dispatched as uc:paid, uc:closed and uc:error.

## Webhooks: the only proof of payment

Set a webhook URL in the dashboard (Settings). Zap POSTs JSON { id, event, createdAt, data } with headers x-uc-event, x-uc-event-id, x-uc-timestamp and x-uc-signature.

Signature: "sha256=" + hex(HMAC-SHA256(secret, timestamp + "." + rawBody)). The secret is in the dashboard (Notifications). Compare in constant time, reject timestamps older than 5 minutes, and ignore event ids already processed (deliveries are retried).

\`\`\`js
${WEBHOOK_VERIFY_NODE}
\`\`\`

Events:
- payment.succeeded: data { sessionId, receiptId, orderRef, productId, metadata, amount, expectedAmount, kind, product }. Amounts are USDC with 6 decimals ("49000000" = $49). Fulfil when productId is the one expected and amount >= expectedAmount.
- receipt.released: escrowed money was paid out to the shop.
- refund.requested, refund.escalated, refund.approved, refund.rejected, refund.executed: the refund flow. Revoke access on refund.executed if needed.
- subscription.cancelled: a prepaid plan was cancelled; periods not yet started go back to the customer.

Shops without a server can skip webhooks: payments and refunds also arrive by email and in the dashboard's Orders tab.

## Payment links

No website: ${origin}/pay?merchant=YOUR_MERCHANT_ID&product-id=PRODUCT_ID opens the checkout directly (works as a QR code).

## Content Security Policy

If the site sets a CSP, allow ${origin} in script-src, frame-src and connect-src.
`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300", "access-control-allow-origin": "*" } });
}
