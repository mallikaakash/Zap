/**
 * Settlement worker logic (SPEC §2). The only place the executor key is used.
 *
 *   payments  swap delivered to the contract → `mint_receipt`; direct payments are just recorded
 *   cases     triage timeouts → `ai_decide` → `finalize_request` → `execute_refund` → delivery
 *   releases  window over / tranche due / customer confirmed → `release`
 *   webhooks  signed, retried deliveries
 *
 * Every step is idempotent: after a restart it resumes from contract state, the swap
 * provider's status and the database (SPEC §9c #4).
 */
import { db, type RefundCase } from "@uc/db";
import { ChainError, type Receipt } from "@uc/chain";
import { isTerminalStatus } from "@uc/intents-adapter";
import { requestActive, runTriage, syncSessionStatus } from "./receipts";
import type { Decision } from "./refund-agent";
import { getAdapter, getChain, getConfig, getMockAdapter } from "./runtime";
import { mintArgsFor } from "./sessions";
import { deliverPendingWebhooks, enqueueWebhook } from "./webhooks";

export type Log = (msg: string) => void;
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function recordPaid(sessionId: string, receipt: Receipt, txHash?: string): Promise<void> {
  const s = await db.session.findUniqueOrThrow({ where: { id: sessionId } });
  const mismatch = receipt.amount !== s.amount ? `Paid ${receipt.amount} but the order was ${s.amount}` : null;
  await db.session.update({ where: { id: s.id }, data: { status: "paid", receiptId: receipt.id, mintTxHash: txHash ?? s.mintTxHash, paidAt: new Date(), error: mismatch } });
  await db.chainEvent.create({ data: { receiptId: receipt.id, event: "receipt_minted", dataJson: JSON.stringify({ amount: receipt.amount, direct: s.direct }), txHash } });
  await enqueueWebhook(s.merchantId, "payment.succeeded", { sessionId: s.id, receiptId: receipt.id, orderRef: s.orderRef, amount: receipt.amount, expectedAmount: s.amount, kind: s.kind, product: s.product });
}

/** Payments: money reached the contract → there must be exactly one receipt for the order. */
export async function tickPayments(log: Log = () => {}): Promise<void> {
  const chain = getChain();
  const { executor } = getConfig();
  const sessions = await db.session.findMany({ where: { status: { in: ["quoted", "deposit_detected"] } }, orderBy: { updatedAt: "asc" }, take: 50 });
  for (const s of sessions) {
    try {
      // Already minted? (direct payment, or an earlier attempt that crashed after minting)
      const existing = await chain.getReceiptByOrderRef(s.orderRefHash);
      if (existing) {
        await recordPaid(s.id, existing);
        log(`session ${s.id}: receipt #${existing.id} found on chain`);
        continue;
      }
      if (s.direct || !s.depositAddress) {
        if (s.status === "quoted" && s.quoteDeadline && s.quoteDeadline < new Date()) await db.session.update({ where: { id: s.id }, data: { status: "expired" } });
        continue;
      }

      const status = await getAdapter().status(s.depositAddress, s.depositMemo ?? undefined);
      if (status !== "SUCCESS") {
        if (isTerminalStatus(status)) {
          // INCOMPLETE_DEPOSIT = underpaid; REFUNDED = the provider sent the coins back; FAILED = expired or failed.
          const state = status === "INCOMPLETE_DEPOSIT" ? "underpaid" : s.quoteDeadline && s.quoteDeadline < new Date() ? "expired" : "failed";
          const why = { underpaid: "Less than the quoted amount arrived. The swap provider returns short deposits to your refund address.", expired: "The quote expired before a payment arrived.", failed: `The swap ended as ${status}; any deposit is returned to your refund address.` }[state];
          await db.session.update({ where: { id: s.id }, data: { status: state, error: why } });
          log(`session ${s.id}: swap ${status}`);
        } else if (status !== "PENDING_DEPOSIT" && s.status === "quoted") {
          await db.session.update({ where: { id: s.id }, data: { status: "deposit_detected" } });
        }
        continue;
      }

      const tx = await chain.mintReceipt(executor, mintArgsFor(s, await chain.now()));
      const receipt = await chain.getReceiptByOrderRef(s.orderRefHash);
      if (!receipt) throw new Error("mint_receipt returned but the receipt is not visible yet");
      await recordPaid(s.id, receipt, tx.txHash);
      log(`session ${s.id}: minted receipt #${receipt.id} for ${s.amount}`);
    } catch (e) {
      // Typical transient cases: the USDC has not landed yet, or another mint holds the lock. Retry next tick.
      await db.session.update({ where: { id: s.id }, data: { error: e instanceof ChainError ? `Waiting to mint: ${e.message}` : errText(e) } }).catch(() => {});
      log(`session ${s.id}: ${errText(e)}`);
    }
  }
}

function releaseDue(r: Receipt, now: Date): boolean {
  if (requestActive(r) || BigInt(r.inFlight) > 0n) return false;
  if (r.kind === "OneTime") return (r.confirmed || now >= new Date(r.windowEnd)) && BigInt(r.amount) > BigInt(r.released) + BigInt(r.refunded);
  return r.schedule.some((t) => t.state === "Pending" && now >= new Date(t.at));
}

/** Releases. Anyone may call `release`; the worker just does it on time. */
export async function tickReleases(log: Log = () => {}): Promise<void> {
  const chain = getChain();
  const { executor } = getConfig();
  const open = await db.session.findMany({ where: { status: "paid", receiptId: { not: null } }, take: 200 });
  if (open.length === 0) return;
  if ((await chain.getConfig()).paused) return;
  const now = await chain.now();
  for (const s of open) {
    try {
      const r = await chain.getReceipt(s.receiptId!);
      if (!r) continue;
      if (!releaseDue(r, now)) {
        await syncSessionStatus(r);
        continue;
      }
      const tx = await chain.release(executor, r.id);
      const after = (await chain.getReceipt(r.id)) ?? r;
      const paid = (BigInt(after.released) - BigInt(r.released)).toString();
      if (paid === "0") continue;
      await db.chainEvent.create({ data: { receiptId: r.id, event: "released", dataJson: JSON.stringify({ amount: paid }), txHash: tx.txHash } });
      await enqueueWebhook(r.merchantId, "receipt.released", { receiptId: r.id, orderRef: s.orderRef, amount: paid, totalReleased: after.released });
      await syncSessionStatus(after);
      log(`receipt #${r.id}: released ${paid} to the merchant`);
    } catch (e) {
      log(`receipt #${s.receiptId}: release failed: ${errText(e)}`);
    }
  }
}

function formatOut(minor: string, decimals: number): string {
  const n = BigInt(minor);
  const base = 10n ** BigInt(decimals);
  const frac = (n % base).toString().padStart(decimals, "0").slice(0, 8).replace(/0+$/, "");
  return `${n / base}${frac ? "." + frac : ""}`;
}

async function note(c: RefundCase, text: string, extra: Record<string, unknown> = {}): Promise<void> {
  const fresh = await db.refundCase.findUniqueOrThrow({ where: { id: c.id } });
  const messages = [...(JSON.parse(fresh.messagesJson) as unknown[]), { role: "system", text, at: new Date().toISOString() }];
  await db.refundCase.update({ where: { id: c.id }, data: { messagesJson: JSON.stringify(messages), ...extra } });
}

/** Send an approved refund out of escrow, towards the customer's original coin and chain. */
async function payOut(c: RefundCase, r: Receipt, log: Log): Promise<void> {
  const chain = getChain();
  const { executor, receipts, usdc } = getConfig();
  const amount = r.request!.amount;
  const orderRef = (await db.session.findFirst({ where: { receiptId: r.id } }))?.orderRef ?? null;

  // USDC on NEAR needs no swap (also the path for refunds too small to swap, SPEC §9c #6).
  if (r.refundTarget.chain === "near" && r.refundTarget.asset === usdc) {
    const to = r.refundTarget.address;
    await chain.ensureUsdcStorage(executor, to);
    const tx = await chain.executeRefund(executor, r.id, to, amount, "direct-usdc");
    await note(c, `Refund sent: ${formatOut(amount, 6)} USDC to ${to} on NEAR.`, { payoutState: "delivered", depositAddress: to, quoteId: "direct-usdc", amountOut: amount, amountOutFormatted: `${formatOut(amount, 6)} USDC`, txHash: tx.txHash, error: null, closed: true });
    await db.chainEvent.create({ data: { receiptId: r.id, event: "refund_executed", dataJson: JSON.stringify({ amount, depositAccount: to, quoteId: "direct-usdc" }), txHash: tx.txHash } });
    await enqueueWebhook(r.merchantId, "refund.executed", { receiptId: r.id, orderRef, amount, refundTarget: r.refundTarget, txHash: tx.txHash });
    log(`receipt #${r.id}: refunded ${amount} USDC directly to ${to}`);
    return;
  }

  const adapter = getAdapter();
  const quote = await adapter.quoteRefund({ amountUsdc: amount, targetAsset: r.refundTarget.asset, targetAddress: r.refundTarget.address, refundToNear: receipts });
  if (!quote.depositAddress) throw new Error("refund quote has no deposit address");
  const token = (await adapter.listTokens()).find((t) => t.assetId === r.refundTarget.asset);
  const out = token ? `${formatOut(quote.amountOut, token.decimals)} ${token.symbol}` : quote.amountOut;
  await chain.ensureUsdcStorage(executor, quote.depositAddress);
  const tx = await chain.executeRefund(executor, r.id, quote.depositAddress, amount, quote.id);
  await db.refundCase.update({
    where: { id: c.id },
    data: { payoutState: "sent", depositAddress: quote.depositAddress, quoteId: quote.id, amountOut: quote.amountOut, amountOutFormatted: out, quoteJson: JSON.stringify(quote), txHash: tx.txHash, error: null },
  });
  await adapter.submitDeposit?.(quote.depositAddress, tx.txHash, { nearSenderAccount: receipts }).catch(() => {});
  await db.chainEvent.create({ data: { receiptId: r.id, event: "refund_executed", dataJson: JSON.stringify({ amount, depositAccount: quote.depositAddress, quoteId: quote.id, amountOut: out }), txHash: tx.txHash } });
  log(`receipt #${r.id}: ${amount} USDC left escrow → ${out} for ${r.refundTarget.address}`);
}

/** Refund requests: drive each open case one step forward. */
export async function tickCases(log: Log = () => {}): Promise<void> {
  const chain = getChain();
  const { executor } = getConfig();
  const cases = await db.refundCase.findMany({ where: { closed: false }, orderBy: { createdAt: "asc" }, take: 50 });
  if (cases.length === 0) return;
  const now = await chain.now();
  for (const c of cases) {
    try {
      const r = await chain.getReceipt(c.receiptId);
      if (!r) continue;
      const q = r.request;
      const orderRef = async () => (await db.session.findFirst({ where: { receiptId: r.id } }))?.orderRef ?? null;

      // Money already left escrow: wait for the reverse swap to deliver.
      if (c.payoutState === "sent") {
        const mock = getMockAdapter();
        let status = await getAdapter().status(c.depositAddress!);
        if (mock && status !== "SUCCESS") status = await mock.simulateRefundDelivery(c.depositAddress!);
        if (status === "SUCCESS") {
          await note(c, `Refund delivered: ${c.amountOutFormatted} to ${r.refundTarget.address}.`, { payoutState: "delivered", closed: true });
          await db.chainEvent.create({ data: { receiptId: r.id, event: "refund_delivered", dataJson: JSON.stringify({ amountOut: c.amountOutFormatted, target: r.refundTarget }) } });
          await enqueueWebhook(r.merchantId, "refund.executed", { receiptId: r.id, orderRef: await orderRef(), amount: c.amount, refundTarget: r.refundTarget, txHash: c.txHash });
          await syncSessionStatus(r);
          log(`receipt #${r.id}: refund delivered to ${r.refundTarget.address}`);
        } else if (isTerminalStatus(status)) {
          await note(c, "The refund swap did not complete. The USDC was returned to the contract account; the shop has been told.", { payoutState: "failed", closed: true, error: `Refund swap ended as ${status}` });
        }
        continue;
      }

      if (!q || q.state === "Executed") {
        await db.refundCase.update({ where: { id: c.id }, data: { closed: true } });
        await syncSessionStatus(r);
        continue;
      }

      // The customer ran out of time to answer a clarifying question: decide with what there is.
      if (c.aiState === "asking" && q.state === "Open" && c.customerDeadline && c.customerDeadline < new Date()) {
        await runTriage(c.id, true);
        continue;
      }

      // Post the agent's decision on chain. The contract re-checks every limit.
      if (c.aiState === "decided" && c.decisionJson) {
        if (q.state === "Open") {
          const d = JSON.parse(c.decisionJson) as Decision;
          const tx = await chain.aiDecide(executor, r.id, d.decision, d.decision === "deny" || d.decision === "escalate" ? q.amount : d.amount, c.summaryHash ?? "");
          await db.chainEvent.create({ data: { receiptId: r.id, event: "ai_decided", dataJson: JSON.stringify({ decision: d.decision, amount: d.amount, engine: d.engine }), txHash: tx.txHash } });
          log(`receipt #${r.id}: triage → ${d.decision}`);
          const after = await chain.getReceipt(r.id);
          if (after?.request?.state === "Escalated") await enqueueWebhook(r.merchantId, "refund.escalated", { receiptId: r.id, orderRef: await orderRef(), amount: q.amount, summary: d.summary, recommendation: d.decision });
        }
        await db.refundCase.update({ where: { id: c.id }, data: { aiState: "submitted" } });
        continue;
      }

      if (q.state === "AiDenied" || q.state === "Rejected") {
        await db.refundCase.update({ where: { id: c.id }, data: { closed: true } });
        await syncSessionStatus(r);
        continue;
      }

      // Veto window over, or the merchant stayed silent past the deadline → approved.
      const vetoOver = q.state === "AiApproved" && q.vetoUntil && now >= new Date(q.vetoUntil);
      const silence = (q.state === "Open" || q.state === "Escalated") && now >= new Date(q.decisionDeadline) && c.aiState !== "asking";
      if (vetoOver || silence) {
        const tx = await chain.finalizeRequest(executor, r.id);
        await note(c, vetoOver ? "The shop's objection window passed. Your refund is being sent." : "The shop did not answer in time, so your refund was approved automatically.");
        await db.chainEvent.create({ data: { receiptId: r.id, event: "request_finalized", dataJson: JSON.stringify({ reason: vetoOver ? "veto_window_passed" : "merchant_silent" }), txHash: tx.txHash } });
        log(`receipt #${r.id}: request finalised (${vetoOver ? "veto window passed" : "merchant silent"})`);
        continue;
      }

      if (q.state === "Approved" && c.payoutState === "none") await payOut(c, r, log);
    } catch (e) {
      await db.refundCase.update({ where: { id: c.id }, data: { error: errText(e) } }).catch(() => {});
      log(`case ${c.id} (receipt #${c.receiptId}): ${errText(e)}`);
    }
  }
}

export async function tickAll(log: Log = () => {}): Promise<void> {
  await tickPayments(log);
  await tickCases(log);
  await tickReleases(log);
  const delivered = await deliverPendingWebhooks().catch(() => 0);
  if (delivered) log(`delivered ${delivered} webhook(s)`);
}
