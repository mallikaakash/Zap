// Pixel & Pine demo store: serves the pages and receives Zap's signed webhook.
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

/** Verified webhook events, newest first. A real shop would use its database. */
const events = [];
const seen = new Set();

const usd = (minor) => (minor ? `$${(Number(minor) / 1e6).toFixed(2)}` : "");

function verify(raw, ts, sig) {
  if (!SECRET || !ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // replayed or stale
  const expected = "sha256=" + createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex");
  return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
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
  if (req.method === "POST" && url.pathname === "/webhooks/zap") {
    const raw = await readBody(req); // the exact bytes: re-serialised JSON would not match the signature
    if (!verify(raw, req.headers["x-uc-timestamp"], req.headers["x-uc-signature"])) {
      console.warn(`[webhook] rejected: bad or missing signature${SECRET ? "" : " (ZAP_WEBHOOK_SECRET is not set)"}`);
      return json(res, 401, { error: "bad signature" });
    }
    const evt = JSON.parse(raw);
    if (seen.has(evt.id)) return json(res, 200, { ok: true, duplicate: true }); // deliveries are retried
    seen.add(evt.id);
    const d = evt.data ?? {};
    // A real shop would also check d.productId is the product being sold and d.amount >= d.expectedAmount.
    events.unshift({ id: evt.id, event: evt.event, receivedAt: new Date().toISOString(), receiptId: d.receiptId ?? null, product: d.product ?? "", productId: d.productId ?? null, amountUsd: usd(d.amount), orderRef: d.orderRef ?? null });
    console.log(`[webhook] ${evt.event} receipt #${d.receiptId ?? "?"} ${usd(d.amount)} ${d.product ?? ""} (signature ok)`);
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
  console.log(`Pixel & Pine demo store on http://localhost:${PORT}`);
  console.log(SECRET ? "Webhook secret loaded." : "ZAP_WEBHOOK_SECRET is not set: webhooks will be rejected. See README.md.");
});
