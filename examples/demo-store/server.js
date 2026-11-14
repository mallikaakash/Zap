// SuperSaaaS demo shop: serves the pages. No payments yet.
// No dependencies. Run: node server.js   (Node 18+)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT) || 4000;
const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PAGES = { "/index.html": "text/html; charset=utf-8", "/thanks.html": "text/html; charset=utf-8", "/orders.html": "text/html; charset=utf-8", "/style.css": "text/css; charset=utf-8" };

/**
 * Orders and payment events, newest first. A real shop would use its database.
 * Shape shown on /orders.html: { id, event, receivedAt, receiptId, product, productId, amountUsd, status }.
 * Nothing adds to this yet: the shop does not take payments.
 */
const events = [];

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // What the pages read.
  if (req.method === "GET" && url.pathname === "/api/orders") {
    const receipt = url.searchParams.get("receipt");
    if (receipt !== null) return json(res, 200, { order: events.find((e) => e.event === "payment.succeeded" && String(e.receiptId) === receipt) ?? null });
    return json(res, 200, { events });
  }

  // The shop's pages (an explicit list, so nothing else in this folder is served).
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
});
