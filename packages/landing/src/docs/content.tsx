"use client";

import { useApp } from "../context";
import { DOC_NAV } from "./nav";
import { CodeBlock, DocPage, DocTable } from "./prose";

export function DocsIntro() {
  const { href, host } = useApp();
  const origin = host || "https://your-zap-host";
  return (
    <DocPage
      title="Zap developer documentation"
      lede="Integrate hosted checkout on your site. Shoppers pay in any coin NEAR Intents supports; you receive USDC and a signed webhook when a receipt is minted."
    >
      <h2>Three surfaces</h2>
      <DocTable
        headers={["Surface", "URL", "Who"]}
        rows={[
          ["Marketing", href("/"), "Buyers and merchants evaluating Zap"],
          ["Docs", href("/docs"), "Engineers integrating pay.js"],
          ["Application", `${origin}/dashboard`, "Merchants configuring shop, webhooks, products"],
        ]}
      />
      <h2>Integration path</h2>
      <ol>
        <li>Register a shop in the <a href={href("/dashboard")}>dashboard</a>.</li>
        <li>Add <code className="z-mono">pay.js</code> and <code className="z-mono">&lt;pay-button&gt;</code> to your site.</li>
        <li>Confirm payments on your server with <a href={href("/docs/webhooks")}>webhooks</a> — never trust the browser alone.</li>
      </ol>
      <h2>Pages</h2>
      <ul className="z-docs-cards">
        {DOC_NAV.filter((d) => d.href !== "/docs").map((d) => (
          <li key={d.href}>
            <a href={href(d.href)} className="z-docs-card">
              <span className="z-display" style={{ fontSize: 17 }}>
                {d.title}
              </span>
              <span className="z-muted" style={{ fontSize: 14 }}>
                {d.description}
              </span>
            </a>
          </li>
        ))}
      </ul>
      <h2>Local sandbox</h2>
      <CodeBlock title="No keys required">{`pnpm install\npnpm demo`}</CodeBlock>
    </DocPage>
  );
}

export function DocsQuickstart() {
  const { href, host } = useApp();
  const h = host || "https://your-zap-host";
  return (
    <DocPage title="Quickstart" lede="Two lines on your pricing page, plus a webhook handler when you go to production.">
      <h2>1. Create a merchant</h2>
      <p>
        Open the <a href={href("/dashboard")}>merchant dashboard</a>, name your shop, set payout account and refund policy, then copy your merchant id (e.g. <code className="z-mono">your-shop.near</code>).
      </p>
      <h2>2. Embed checkout</h2>
      <CodeBlock title="your-site.html">{`<script src="${h}/pay.js" defer></script>\n<pay-button merchant="your-shop.near" amount="49" product="Pro plan" />`}</CodeBlock>
      <h2>3. Listen in the browser (optional)</h2>
      <CodeBlock>{`document.querySelector("pay-button")\n  ?.addEventListener("uc:paid", (e) => console.log(e.detail.receiptUrl));`}</CodeBlock>
      <p>Use this for UX only. Fulfill orders after a verified <a href={href("/docs/webhooks")}>webhook</a>.</p>
      <h2>4. Payment links</h2>
      <CodeBlock>{`${h}/pay?merchant=your-shop.near&amount=49&product=Pro%20plan`}</CodeBlock>
    </DocPage>
  );
}

export function DocsEmbed() {
  const { href, host } = useApp();
  const h = host || "https://your-zap-host";
  return (
    <DocPage title="Pay button" lede="Custom element with Shadow DOM. Served as a single pay.js bundle from your Zap host.">
      <CodeBlock title="Script">{`<script src="${h}/pay.js" defer></script>`}</CodeBlock>
      <h2>Core attributes</h2>
      <DocTable
        headers={["Attribute", "Notes"]}
        rows={[
          ["merchant", "Required shop id from the dashboard"],
          ["amount", "USD decimal for one-time payments"],
          ['mode', '"one-time" | "subscription" | "schedule"'],
          ["api", "Zap host if pay.js is loaded from a CDN or another origin"],
          ['display', '"modal" (default) or "redirect"'],
        ]}
      />
      <h2>Programmatic API</h2>
      <p>
        After <code className="z-mono">pay.js</code> loads, <code className="z-mono">window.Zap</code> exposes <code className="z-mono">createSession</code>, <code className="z-mono">openCheckout</code>, and <code className="z-mono">checkoutLink</code>.
      </p>
      <p className="z-muted" style={{ fontSize: 14 }}>
        Full attribute list: see <code className="z-mono">packages/sdk/README.md</code> in the repo.
      </p>
    </DocPage>
  );
}

export function DocsEvents() {
  return (
    <DocPage title="Checkout events" lede="Modal checkout runs in an iframe and communicates with your page via postMessage. The pay button also emits DOM events.">
      <h2>postMessage (hosted checkout → parent)</h2>
      <CodeBlock>{`{ source: "zap", type: "uc:paid" | "uc:close" | "uc:resize", … }`}</CodeBlock>
      <DocTable
        headers={["type", "Meaning"]}
        rows={[
          ["uc:paid", "Payment succeeded; includes receiptId and receiptUrl"],
          ["uc:close", "Modal closed"],
          ["uc:resize", "Content height changed (desktop modal)"],
        ]}
      />
      <h2>DOM events on &lt;pay-button&gt;</h2>
      <DocTable
        headers={["Event", "When"]}
        rows={[
          ["uc:paid", "Same as postMessage paid"],
          ["uc:closed", "Modal closed; detail.paid is boolean"],
          ["uc:error", "Session creation failed"],
        ]}
      />
    </DocPage>
  );
}

export function DocsWebhooks() {
  return (
    <DocPage title="Webhooks" lede="Your backend is the source of truth for fulfillment. Each delivery is HMAC-signed and idempotent.">
      <p>Set the webhook URL in the merchant dashboard. Zap stores a secret starting with <code className="z-mono">whsec_</code>.</p>
      <h2>Verify signatures</h2>
      <CodeBlock title="Handler sketch">{`const sig = req.headers["x-uc-signature"];\nconst ts = req.headers["x-uc-timestamp"];\n// HMAC-SHA256 over "{timestamp}.{rawBody}"\nif (!valid(sig, ts, rawBody, secret)) return 401;\nif (Math.abs(now - Number(ts)) > 300) return 401;\nif (await seen(event.id)) return 200;`}</CodeBlock>
      <p>Failed deliveries are retried with backoff. Deduplicate using the event <code className="z-mono">id</code>.</p>
    </DocPage>
  );
}

export function DocsApi() {
  const { href } = useApp();
  return (
    <DocPage title="HTTP API" lede="REST JSON on your Zap host. Amounts are USDC minor units (6 dp) as strings — never floats.">
      <h2>Create a session</h2>
      <CodeBlock title="POST /api/sessions">{`{\n  "merchantId": "your-shop.near",\n  "amountUsd": "49000000",\n  "kind": "OneTime",\n  "orderRef": "order_123",\n  "product": "Pro plan"\n}`}</CodeBlock>
      <p>Returns <code className="z-mono">sessionId</code> and <code className="z-mono">checkoutUrl</code>. CORS is enabled for merchant origins on this route.</p>
      <h2>Other routes</h2>
      <ul>
        <li><code className="z-mono">GET/POST /api/merchants</code> — dashboard registration</li>
        <li><code className="z-mono">GET /api/verify/:id</code> — public receipt audit</li>
        <li><code className="z-mono">GET {href("/api/dev/state")}</code> — mode and contract addresses (after deploy)</li>
      </ul>
      <p>On-chain interface: <code className="z-mono">contracts/INTERFACE.md</code></p>
    </DocPage>
  );
}