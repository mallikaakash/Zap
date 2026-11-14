// SuperSaaaS demo shop: serves the pages and receives Zap's signed webhook.
// No dependencies. Run: ZAP_WEBHOOK_SECRET=... node server.js   (Node 18+)
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT) || 4000;
const SECRET = process.env.ZAP_WEBHOOK_SECRET || "";
const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PAGES = { "/index.html": "text/html; charset=utf-8", "/thanks.html": "text/html; charset=utf-8", "/orders.html": "text/html; charset=utf-8", "/style.css": "text/css; charset=utf-8" };

/** What this shop sells: the product-id from the Zap dashboard → what a payment for it unlocks. Keep in sync with index.html. */
const PRODUCTS = { cmwg1bh1q0002s654xkmaqg1d: "SuperSaaaS Pro" };

/** Verified webhook events, newest first. A real shop would use its database. */
const events = [];
const seen = new Set();

const usd = (minor) => (minor ? `$${(Number(minor) / 1e6).toFixed(2)}` : "");

/** "sha256=" + HMAC-SHA256(secret, timestamp + "." + rawBody), constant-time, max 5 minutes old. */
function verify(raw, ts, sig) {
  if (!SECRET || typeof ts !== "string" || typeof sig !== "string") return false;
  if (!/^\d+$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = "sha256=" + createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex");
  return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/** Decide what a verified event means for this shop. Returns the status shown on the orders page. */
function apply(evt) {
  const d = evt.data ?? {};
  switch (evt.event) {
    case "payment.succeeded": {
      if (!PRODUCTS[d.productId]) return `rejected: product-id ${d.productId ?? "(none)"} is not one we sell`;
      if (BigInt(d.amount ?? 0) < BigInt(d.expectedAmount ?? 1)) return `rejected: paid ${usd(d.amount)}, expected ${usd(d.expectedAmount)}`;
      return "paid"; // here a real product would grant access to the customer's account
    }
    case "refund.executed":
      return "refunded: access revoked";
    case "webhook.test":
      return "ok";
    default:
      return "noted";
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // 1. Zap's webhook: the only thing this shop trusts as proof of payment.
  if (req.method === "POST" && (url.pathname === "/api/webhooks/zap" || url.pathname === "/webhooks/zap")) {
    const raw = await readBody(req); // the exact bytes: re-serialised JSON would not match the signature
    if (!verify(raw, req.headers["x-uc-timestamp"], req.headers["x-uc-signature"])) {
      console.warn(`[webhook] rejected: bad, missing or stale signature${SECRET ? "" : " (ZAP_WEBHOOK_SECRET is not set)"}`);
      return json(res, 401, { error: "bad signature" });
    }
    const evt = JSON.parse(raw);
    if (seen.has(evt.id)) return json(res, 200, { ok: true, duplicate: true }); // deliveries are retried
    seen.add(evt.id);
    const d = evt.data ?? {};
    const status = apply(evt);
    events.unshift({ id: evt.id, event: evt.event, receivedAt: new Date().toISOString(), receiptId: d.receiptId ?? null, product: d.product ?? "", productId: d.productId ?? null, amountUsd: usd(d.amount), status });
    console.log(`[webhook] ${evt.event}${d.receiptId ? ` receipt #${d.receiptId}` : ""} ${usd(d.amount)} → ${status} (signature ok)`);
    return json(res, 200, { ok: true });
  }

  // 2. What the pages read.
  if (req.method === "GET" && url.pathname === "/api/orders") {
    const receipt = url.searchParams.get("receipt");
    if (receipt !== null) return json(res, 200, { order: events.find((e) => e.event === "payment.succeeded" && String(e.receiptId) === receipt) ?? null });
    return json(res, 200, { events });
  }

  // 3. The shop's pages (an explicit list, so nothing else in this folder is served).
  if (req.method === "GET") {
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    if (PAGES[path]) {
      res.writeHead(200, { "content-type": PAGES[path] });
      return res.end(await readFile(join(ROOT, path)));
    }
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
}).listen(PORT, () => {
  console.log(`SuperSaaaS demo shop on http://localhost:${PORT}`);
  console.log(SECRET ? "Webhook secret loaded. Endpoint: POST /api/webhooks/zap" : "ZAP_WEBHOOK_SECRET is not set: webhooks will be rejected. See README.md.");
});
