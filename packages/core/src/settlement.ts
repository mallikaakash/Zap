/**
 * Settlement worker logic (SPEC §2): confirm payments and mint receipts, run due
 * releases, execute approved refunds, deliver webhooks. Each `tick*` function is
 * safe to call repeatedly; state lives on chain and in the database.
 */
import { db } from "@uc/db";
import { ChainError, type Receipt } from "@uc/chain";
import { isTerminalStatus } from "@uc/intents-adapter";
import { syncSessionStatus } from "./receipts";
import { getAdapter, getChain, getConfig, getMockAdapter } from "./runtime";
import type { ScheduleItem } from "./sessions";
import { deliverPendingWebhooks, enqueueWebhook } from "./webhooks";

export type Log = (msg: string) => void;
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Payments: swap delivered → mint the receipt NFT that holds the money. */
export async function tickPayments(log: Log = () => {}): Promise<void> {
  const chain = getChain();
  const { executor } = getConfig();
  const sessions = await db.session.findMany({ where: { status: { in: ["quoted", "deposit_detected"] }, depositAddress: { not: null } }, orderBy: { updatedAt: "asc" }, take: 50 });
  for (const s of sessions) {
    try {
      const status = await getAdapter().status(s.depositAddress!, s.depositMemo ?? undefined);
      if (status !== "SUCCESS") {
        if (isTerminalStatus(status)) {
          await db.session.update({ where: { id: s.id }, data: { status: s.quoteDeadline && s.quoteDeadline < new Date() ? "expired" : "failed", error: `Swap ended as ${status}` } });
          log(`session ${s.id}: swap ${status}`);
        } else if (status !== "PENDING_DEPOSIT" && s.status === "quoted") {
          await db.session.update({ where: { id: s.id }, data: { status: "deposit_detected" } });
        }
        continue;
      }

      // Idempotent: a previous attempt may have minted and then crashed.
      let receipt = await chain.getReceiptByOrderRef(s.merchantId, s.orderRef);
      let txHash: string | undefined;
      if (!receipt) {
        const now = await chain.now();
        const schedule = (JSON.parse(s.scheduleJson) as ScheduleItem[]).map((t) => ({ at: new Date(now.getTime() + t.afterSecs * 1000).toISOString(), amount: t.amount }));
        const tx = await chain.mintReceipt(executor, {
          merchantId: s.merchantId,
          orderRef: s.orderRef,
          amount: s.amount,
          kind: s.kind as Receipt["kind"],
          schedule,
          refundTarget: { chain: s.originChain ?? "", asset: s.originAsset ?? "", address: s.refundAddress ?? "" },
          secretHash: s.secretHash ?? undefined,
        });
        txHash = tx.txHash;
        receipt = await chain.getReceiptByOrderRef(s.merchantId, s.orderRef);
        if (!receipt) throw new Error("mint_receipt returned but the receipt is not visible yet");
      }
      await db.session.update({ where: { id: s.id }, data: { status: "paid", receiptId: receipt.id, mintTxHash: txHash, paidAt: new Date(), error: null } });
      await db.chainEvent.create({ data: { receiptId: receipt.id, event: "receipt_minted", dataJson: JSON.stringify({ amount: s.amount, orderRef: s.orderRef }), txHash } });
      await enqueueWebhook(s.merchantId, "payment.succeeded", { sessionId: s.id, receiptId: receipt.id, orderRef: s.orderRef, amount: s.amount, kind: s.kind, product: s.product });
      log(`session ${s.id}: minted receipt #${receipt.id} for ${s.amount}`);
    } catch (e) {
      // Typical transient case: the USDC has not landed in the contract yet. Try again next tick.
      await db.session.update({ where: { id: s.id }, data: { error: e instanceof ChainError ? `Waiting to mint: ${e.message}` : msg(e) } }).catch(() => {});
      log(`session ${s.id}: ${msg(e)}`);
    }
  }
}

function releaseDue(r: Receipt, now: Date): boolean {
  if (r.status !== "Held" && r.status !== "PartiallyReleased") return false;
  if (r.kind === "OneTime") return now >= new Date(r.windowEnd) && BigInt(r.amount) > BigInt(r.released) + BigInt(r.refunded);
  return r.schedule.some((t) => t.state === "Pending" && now >= new Date(t.at));
}

/** Releases: refund window over, or a tranche is due → pay the merchant. Anyone may call `release`; the worker just does it on time. */
export async function tickReleases(log: Log = () => {}): Promise<void> {
  const chain = getChain();
  const { executor } = getConfig();
  const open = await db.session.findMany({ where: { status: "paid", receiptId: { not: null } }, take: 200 });
  if (open.length === 0) return;
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
      await enqueueWebhook(r.merchantId, "receipt.released", { receiptId: r.id, orderRef: r.orderRef, amount: paid, totalReleased: after.released });
      await syncSessionStatus(after);
      log(`receipt #${r.id}: released ${paid} to the merchant`);
    } catch (e) {
      log(`receipt #${s.receiptId}: release failed: ${msg(e)}`);
    }
  }
}

/** Refunds: approved request → reverse-swap quote → contract pays the deposit address → customer gets their coin back. */
export async function tickRefunds(log: Log = () => {}): Promise<void> {
  const chain = getChain();
  const { executor, receipts } = getConfig();
  const jobs = await db.refundJob.findMany({ where: { status: { in: ["requested", "pending_approval", "sent"] } }, orderBy: { createdAt: "asc" }, take: 50 });
  for (const job of jobs) {
    try {
      const r = await chain.getReceipt(job.receiptId);
      if (!r) continue;

      if (job.status === "sent") {
        // Money left escrow; wait for the reverse swap to deliver.
        const mock = getMockAdapter();
        let status = await getAdapter().status(job.depositAddress!);
        if (mock && status !== "SUCCESS") status = await mock.simulateRefundDelivery(job.depositAddress!);
        if (status === "SUCCESS") {
          await db.refundJob.update({ where: { id: job.id }, data: { status: "delivered" } });
          await db.chainEvent.create({ data: { receiptId: r.id, event: "refund_delivered", dataJson: JSON.stringify({ amountOut: job.amountOutFormatted, target: r.refundTarget }) } });
          await enqueueWebhook(r.merchantId, "refund.executed", { receiptId: r.id, orderRef: r.orderRef, amount: job.amount, refundTarget: r.refundTarget, txHash: job.txHash });
          log(`receipt #${r.id}: refund delivered to ${r.refundTarget.address}`);
        } else if (isTerminalStatus(status)) {
          await db.refundJob.update({ where: { id: job.id }, data: { status: "failed", error: `Refund swap ended as ${status}; the USDC was returned to the contract account` } });
        }
        continue;
      }

      if (r.status === "PendingApproval") {
        if (job.status !== "pending_approval") await db.refundJob.update({ where: { id: job.id }, data: { status: "pending_approval" } });
        continue;
      }
      if (r.status !== "RefundRequested") {
        // Rejected by the merchant, or already handled.
        await db.refundJob.update({ where: { id: job.id }, data: { status: BigInt(r.pendingRefund) === 0n && job.status === "pending_approval" ? "rejected" : "failed", error: "No refund is pending on chain" } });
        await syncSessionStatus(r);
        continue;
      }

      const amount = r.pendingRefund;
      const quote = await getAdapter().quoteRefund({ amountUsdc: amount, targetAsset: r.refundTarget.asset, targetAddress: r.refundTarget.address, refundToNear: receipts });
      if (!quote.depositAddress) throw new Error("refund quote has no deposit address");
      const tokens = await getAdapter().listTokens();
      const token = tokens.find((t) => t.assetId === r.refundTarget.asset);
      const out = token ? formatOut(quote.amountOut, token.decimals) + " " + token.symbol : quote.amountOut;
      await chain.ensureUsdcStorage(executor, quote.depositAddress);
      const tx = await chain.executeRefund(executor, r.id, quote.depositAddress, amount);
      await db.refundJob.update({
        where: { id: job.id },
        data: { status: "sent", amount, depositAddress: quote.depositAddress, amountOut: quote.amountOut, amountOutFormatted: out, quoteJson: JSON.stringify(quote), txHash: tx.txHash, error: null },
      });
      await getAdapter().submitDeposit?.(quote.depositAddress, tx.txHash, { nearSenderAccount: receipts }).catch(() => {});
      await db.chainEvent.create({ data: { receiptId: r.id, event: "refund_executed", dataJson: JSON.stringify({ amount, depositAccount: quote.depositAddress, amountOut: out }), txHash: tx.txHash } });
      const after = await chain.getReceipt(r.id);
      if (after) await syncSessionStatus(after);
      log(`receipt #${r.id}: refunded ${amount} USDC → ${out} to ${r.refundTarget.address}`);
    } catch (e) {
      await db.refundJob.update({ where: { id: job.id }, data: { error: msg(e) } }).catch(() => {});
      log(`refund job ${job.id}: ${msg(e)}`);
    }
  }
}

function formatOut(minor: string, decimals: number): string {
  const n = BigInt(minor);
  const base = 10n ** BigInt(decimals);
  const frac = (n % base).toString().padStart(decimals, "0").slice(0, 8).replace(/0+$/, "");
  return `${n / base}${frac ? "." + frac : ""}`;
}

export async function tickAll(log: Log = () => {}): Promise<void> {
  await tickPayments(log);
  await tickRefunds(log);
  await tickReleases(log);
  const delivered = await deliverPendingWebhooks().catch(() => 0);
  if (delivered) log(`delivered ${delivered} webhook(s)`);
}
