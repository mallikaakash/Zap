/**
 * Everything a seller (or their coding agent) needs to put the pay button on a site.
 * Pure functions: used by the dashboard and by /llms.txt.
 */

export type Platform = "html" | "nocode" | "react" | "next" | "vue" | "angular";

export const PLATFORMS: Array<{ id: Platform; label: string }> = [
  { id: "html", label: "HTML" },
  { id: "nocode", label: "WordPress · Webflow · Shopify" },
  { id: "react", label: "React" },
  { id: "next", label: "Next.js" },
  { id: "vue", label: "Vue" },
  { id: "angular", label: "Angular" },
];

/** `merchant="…" product-id="…" label="…"` in a stable order. */
export function buttonAttrs(a: Record<string, string | undefined>): string {
  return Object.entries(a)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}="${String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`)
    .join(" ");
}

export interface Step {
  title: string;
  file?: string;
  code: string;
}

const TS_DECL = `import "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "pay-button": React.HTMLAttributes<HTMLElement> & { [attr: string]: unknown };
    }
  }
}`;

/** Steps to add the button on each platform. `attrs` is the output of buttonAttrs. */
export function integrationSteps(platform: Platform, origin: string, attrs: string): Step[] {
  const script = `<script src="${origin}/pay.js" defer></script>`;
  const tag = `<pay-button ${attrs}></pay-button>`;
  switch (platform) {
    case "html":
      return [{ title: "Paste where the button should appear. The script line goes in once per page.", code: `${script}\n${tag}` }];
    case "nocode":
      return [
        { title: "Add a custom-code block where the button should appear: WordPress → Custom HTML block; Webflow → Embed element; Shopify → Custom Liquid section; Wix → Embed code; Framer → Embed. Paste:", code: `${script}\n${tag}` },
      ];
    case "react":
      return [
        { title: "Load the script once, in the <head> of your HTML page.", file: "index.html", code: script },
        { title: "Use the tag in any component.", file: "Pricing.tsx", code: `export function BuyButton() {\n  return ${tag};\n}` },
        { title: "TypeScript only: teach JSX about the tag (once per project).", file: "src/pay-button.d.ts", code: TS_DECL },
        {
          title: "Optional: react when the customer has paid (show a thank-you; fulfil on the webhook, not here).",
          code: `const ref = useRef<HTMLElement>(null);\nuseEffect(() => {\n  const el = ref.current;\n  const onPaid = (e: Event) => console.log("paid", (e as CustomEvent).detail);\n  el?.addEventListener("zap-paid", onPaid);\n  return () => el?.removeEventListener("zap-paid", onPaid);\n}, []);\n// <pay-button ref={ref} ${attrs}></pay-button>`,
        },
      ];
    case "next":
      return [
        { title: "Load the script once, in the root layout.", file: "app/layout.tsx", code: `import Script from "next/script";\n\n// inside <body>:\n<Script src="${origin}/pay.js" strategy="afterInteractive" />` },
        { title: "Use the tag on any page or component (server components are fine).", file: "app/pricing/page.tsx", code: tag },
        { title: "TypeScript: teach JSX about the tag (once per project).", file: "pay-button.d.ts", code: TS_DECL },
      ];
    case "vue":
      return [
        { title: "Load the script once.", file: "index.html", code: script },
        { title: "Tell Vue that pay-button is a web component.", file: "vite.config.ts", code: `vue({\n  template: { compilerOptions: { isCustomElement: (tag) => tag === "pay-button" } },\n})` },
        { title: "Use it in any template.", file: "Pricing.vue", code: `<pay-button ${attrs} @zap-paid="onPaid"></pay-button>` },
      ];
    case "angular":
      return [
        { title: "Load the script once.", file: "src/index.html", code: script },
        { title: "Allow the custom tag in the component that uses it.", file: "pricing.component.ts", code: `import { Component, CUSTOM_ELEMENTS_SCHEMA } from "@angular/core";\n\n@Component({\n  selector: "app-pricing",\n  standalone: true,\n  schemas: [CUSTOM_ELEMENTS_SCHEMA],\n  templateUrl: "./pricing.component.html",\n})\nexport class PricingComponent {\n  onPaid(e: Event) { console.log("paid", (e as CustomEvent).detail); }\n}` },
        { title: "Use it in the template.", file: "pricing.component.html", code: `<pay-button ${attrs} (zap-paid)="onPaid($event)"></pay-button>` },
      ];
  }
}

export const WEBHOOK_VERIFY_NODE = `// Verify before you trust it. SECRET = your signing secret (dashboard → Notifications).
const ts  = req.headers["x-uc-timestamp"];
const sig = req.headers["x-uc-signature"];           // "sha256=<hex>"
const expected = "sha256=" + crypto.createHmac("sha256", SECRET)
  .update(ts + "." + rawBody).digest("hex");         // rawBody = the exact bytes received
const fresh = Math.abs(Date.now() / 1000 - Number(ts)) < 300;
if (!fresh || sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
  return res.status(401).end();
// Deliveries are retried: ignore event ids you have already handled.`;

/** A prompt the seller pastes into Cursor / Claude Code / Lovable / v0 to do the whole integration. */
export function agentPrompt(o: { origin: string; merchant: string; shopName: string; products: Array<{ id: string; name: string; price: string }>; attrs: string }): string {
  const list = o.products.length
    ? o.products.map((p) => `- "${p.name}" (${p.price}): product-id="${p.id}"`).join("\n")
    : `- (no saved products yet; this button uses: ${o.attrs})`;
  return `Add Zap checkout buttons to this project. Zap takes crypto payments in any coin on any chain and pays the shop "${o.shopName}" in USDC; the money is held in escrow until the refund window ends.

## 1. Load the script once per page
<script src="${o.origin}/pay.js" defer></script>
- Plain HTML / no-code builders: put it in the page head or a custom-code block.
- Next.js: \`<Script src="${o.origin}/pay.js" strategy="afterInteractive" />\` (next/script) in the root layout.
- React (Vite/CRA), Vue, Angular, Svelte: add the tag to index.html.

## 2. Place a button where each product is sold
<pay-button merchant="${o.merchant}" product-id="PRODUCT_ID"></pay-button>

Products (the price, refund window and plan come from the server for each product-id, so the page cannot change them):
${list}

Optional attributes: label="Buy now", color="#111111", radius="12", size="sm|md|lg", icon="lock|coins|none", order-ref="<your order id>" (returned in the webhook), metadata='{"userId":"..."}'.

Framework notes:
- React/Next with TypeScript: declare the tag once (module augmentation of "react" JSX.IntrinsicElements with "pay-button").
- Vue: compilerOptions.isCustomElement = (tag) => tag === "pay-button".
- Angular: add CUSTOM_ELEMENTS_SCHEMA to the component's schemas.
- Events (bubble from the element): zap-paid, zap-closed, zap-error (also available as uc:paid etc.). zap-paid is for UI only (a thank-you message). It is NOT proof of payment.

## 3. Fulfil orders only from the signed webhook (only if this project has a server)
Create a POST endpoint, e.g. /api/webhooks/zap, and tell me its public URL so I can paste it into the Zap dashboard (Settings → Webhook URL).
- Read the signing secret from an environment variable ZAP_WEBHOOK_SECRET (I will copy it from the dashboard's Notifications tab). Never hard-code it.
- Use the raw request body. Expected signature: "sha256=" + hex(HMAC-SHA256(secret, timestamp + "." + rawBody)), where timestamp is the x-uc-timestamp header and the signature is in x-uc-signature. Compare in constant time and reject timestamps older than 5 minutes (respond 401).
- Body: { id, event, createdAt, data }. Deliveries are retried, so ignore an event id already processed.
- On event "payment.succeeded": data has { orderRef, productId, amount, expectedAmount, product, metadata, receiptId }. Amounts are USDC with 6 decimals ("49000000" = $49). Mark the order paid only if productId is the one expected and amount >= expectedAmount.
- Other events: receipt.released (money paid out to the shop); refund.requested, refund.escalated, refund.approved, refund.rejected, refund.executed (money returned: revoke access if you need to); subscription.cancelled.
- Respond 200 quickly.

If this project has no server, skip step 3: payments and refunds also arrive by email and in the Zap dashboard.

Full reference: ${o.origin}/llms.txt`;
}
