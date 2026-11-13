/**
 * End-to-end check against a running local sandbox (`pnpm demo --setup-only` in another
 * terminal, or `pnpm test:e2e` which starts one). Drives the same service functions the
 * API routes call, with a real receipt key signing in-process like the browser does.
 */
// Must stay the first import: pins the run to the local sandbox even when a live .env exists.
import "./sandbox-env";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { newReceiptKey, signReceiptAction } from "@uc/chain";
import { createSession, DIRECT_ASSET, getChain, getConfig, listTokens, merchantDecide, mustGet, openRequest, postMessage, claimReceipt, prepareClaimAccount, quoteSession, receiptView, simulatePayment, tickAll, transferReceipt, verifyView } from "@uc/core";
import { db } from "@uc/db";

const log = (m: string) => console.log(`  ${m}`);
const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const ticks = async (n = 3) => {
  for (let i = 0; i < n; i++) await tickAll((m) => log(`[worker] ${m}`));
};
async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, tries = 40): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await tickAll((m) => log(`[worker] ${m}`));
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`timed out waiting for: ${what}`);
}

async function pay(merchantId: string, amount: string, opts: { kind?: "OneTime" | "Subscription"; schedule?: Array<{ afterSecs: number; amount: string }>; direct?: boolean; product?: string } = {}) {
  const key = await newReceiptKey();
  const s = await createSession({ merchantId, amountUsd: amount, kind: opts.kind, schedule: opts.schedule, product: opts.product });
  const tokens = await listTokens();
  const usdt = tokens.find((t) => t.symbol === "USDT" && t.chain === "pol")!;
  await quoteSession(s.id, opts.direct ? { originAsset: DIRECT_ASSET, refundAddress: getConfig().relayer, receiptKey: key.publicKey } : { originAsset: usdt.assetId, refundAddress: "0x1111111111111111111111111111111111111111", receiptKey: key.publicKey });
  await simulatePayment(s.id);
  const paid = await until("receipt minted", async () => {
    const x = await db.session.findUnique({ where: { id: s.id } });
    return x?.receiptId ? x : null;
  });
  return { id: paid.receiptId!, key: key.privateKey };
}

async function main() {
  const chain = getChain();
  const c = getConfig();
  // Belt and braces next to sandbox-env: never run this against a real network.
  assert.equal(c.mode, "local", "e2e only runs against the local sandbox");
  assert.equal(c.networkId, "localnet", "e2e only runs against the local sandbox");
  const merchant = (await db.merchant.findFirst())!;
  assert.ok(merchant, "run the demo setup first");
  const sign = async (id: string, key: string, a: Parameters<typeof signReceiptAction>[4]) => signReceiptAction(key, c.receipts, id, (await mustGet(id)).nonce, a);

  console.log("1. Pay with Polygon USDT (mock swap → mint_receipt)");
  const a = await pay(merchant.id, "18000000", { product: "Ceramic pour-over set" });
  let r = await mustGet(a.id);
  assert.equal(r.amount, "18000000");
  assert.equal(r.status, "Held");
  assert.equal(r.transferable, false);
  log(`receipt #${a.id} holds ${r.amount}; contract USDC balance ${await chain.usdcBalance(c.receipts)}`);

  console.log("2. Refund: assistant asks for a screenshot, then approves; veto window passes; money returns");
  const reason = "Exports are not working since I upgraded to Pro";
  await openRequest(a.id, "refund", { reason, amount: "18000000", auth: { sig: await sign(a.id, a.key, { action: "request_refund", amount: "18000000", reasonHash: sha(reason) }) } });
  let view = await receiptView(a.id);
  assert.equal(view.receipt.request?.state, "Open");
  assert.equal(view.cases[0]!.messages.at(-1)!.role, "agent");
  log(`assistant: ${view.cases[0]!.messages.at(-1)!.text}`);
  await postMessage(a.id, { text: "Screenshot attached", imageName: "export-error.png", auth: { sig: await sign(a.id, a.key, { action: "message", bodyHash: sha("Screenshot attached") }) } });
  await until("AiApproved on chain", async () => (await mustGet(a.id)).request?.state === "AiApproved");
  // replayed signature must be rejected by the contract
  await assert.rejects(async () => chain.requestRefund(c.relayer, a.id, "18000000", sha(reason), await signReceiptAction(a.key, c.receipts, a.id, 0, { action: "request_refund", amount: "18000000", reasonHash: sha(reason) })));
  await chain.fastForward(merchant.vetoSecs + 5);
  await until("refund delivered", async () => (await receiptView(a.id)).cases[0]!.payoutState === "delivered", 60);
  r = await mustGet(a.id);
  assert.equal(r.status, "Refunded");
  assert.equal(r.refunded, "18000000");
  log(`refunded: ${(await receiptView(a.id)).cases[0]!.amountOutFormatted} to the customer's Polygon address`);
  const v = await verifyView(a.id);
  assert.equal(v.attribution?.matches, true);
  assert.equal(v.refunds.length, 1);

  console.log("3. Above the automatic limit → escalated → merchant declines");
  const b = await pay(merchant.id, "45000000", { product: "Grinder" });
  const why = "It never arrived at my address";
  await openRequest(b.id, "refund", { reason: why, auth: { sig: await sign(b.id, b.key, { action: "request_refund", amount: "45000000", reasonHash: sha(why) }) } });
  await until("Escalated on chain", async () => (await mustGet(b.id)).request?.state === "Escalated");
  await merchantDecide(b.id, "reject", "Courier shows a signed delivery");
  assert.equal((await mustGet(b.id)).request?.state, "Rejected");
  await ticks();

  console.log("4. Refund window ends → released to the merchant");
  const before = BigInt(await chain.usdcBalance(merchant.payoutAccount));
  await chain.fastForward(merchant.defaultWindowSecs + 5);
  await until("released", async () => (await mustGet(b.id)).status === "Released", 60);
  assert.equal(BigInt(await chain.usdcBalance(merchant.payoutAccount)) - before, 45000000n);
  log("merchant payout account received 45.00 USDC");

  console.log("5. Pass paid with USDC on NEAR (ft_transfer_call), claimed, transferred, cancelled");
  const p = await pay(merchant.id, "36000000", { kind: "Subscription", direct: true, product: "3-month pass", schedule: [0, 1, 2].map((i) => ({ afterSecs: i * 30 * 86400, amount: "12000000" })) /* demo clock: one month ≈ 60 s */ });
  r = await mustGet(p.id);
  assert.equal(r.transferable, true);
  await until("first period released", async () => (await mustGet(p.id)).released === "12000000");
  const alice = await prepareClaimAccount("alice");
  await claimReceipt(p.id, alice, await sign(p.id, p.key, { action: "claim", account: alice }));
  assert.equal((await mustGet(p.id)).owner, alice);
  const { account: bob } = await transferReceipt(p.id, alice, "bob");
  assert.equal((await mustGet(p.id)).owner, bob);
  log(`pass moved ${alice} → ${bob}`);
  await openRequest(p.id, "cancel", { reason: "I no longer need the remaining months", auth: { owner: bob } });
  const st = await until("cancel decided", async () => {
    const q = (await mustGet(p.id)).request;
    return q && q.state !== "Open" ? q.state : null;
  });
  log(`cancel request → ${st}`);

  console.log("\n✔ end-to-end flow passed");
  await db.$disconnect();
}

main().catch((e) => {
  console.error("\n✖ e2e failed:", e);
  process.exit(1);
});
