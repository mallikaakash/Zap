import { db } from "@uc/db";
import { ChainError, type Receipt } from "@uc/chain";
import { UserError } from "./errors";
import { decideDispute, parsePolicy, type Decision } from "./refund-agent";
import { ensureDemoAccount, ensureSigner, getChain, getConfig } from "./runtime";
import { enqueueWebhook } from "./webhooks";

/** How a caller proves they hold the receipt. */
export type HolderAuth =
  | { secret: string; nextSecretHash: string } // unclaimed: one-time secret + its replacement
  | { owner: string }; // claimed: the NFT owner (demo-custodial accounts only)

const HEX64 = /^[0-9a-f]{64}$/;

export function parseAuth(body: Record<string, unknown>): HolderAuth {
  if (typeof body.owner === "string" && body.owner) return { owner: body.owner };
  if (HEX64.test(String(body.secret)) && HEX64.test(String(body.nextSecretHash))) return { secret: String(body.secret), nextSecretHash: String(body.nextSecretHash) };
  throw new UserError("Provide either { secret, nextSecretHash } (64 hex chars each) or { owner }", 401);
}

async function mustGet(id: string): Promise<Receipt> {
  if (!/^\d+$/.test(id)) throw new UserError("Receipt not found", 404);
  const r = await getChain().getReceipt(id);
  if (!r) throw new UserError("Receipt not found", 404);
  return r;
}

/** Unreleased, unrefunded money not already tied up in a pending request. */
export function refundable(r: Receipt): string {
  if (r.status === "RefundRequested" || r.status === "PendingApproval") return "0";
  if (r.kind === "OneTime") return (BigInt(r.amount) - BigInt(r.released) - BigInt(r.refunded)).toString();
  return r.schedule.filter((t) => t.state === "Pending").reduce((a, t) => a + BigInt(t.amount), 0n).toString();
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ChainError) throw new UserError(e.message, 409);
    throw e;
  }
}

/** Who signs a holder call: the relayer for secret auth, the owner's demo account otherwise. */
async function holderSigner(r: Receipt, auth: HolderAuth): Promise<{ signer: string; secret?: { secret: string; nextSecretHash: string } }> {
  if ("owner" in auth) {
    if (auth.owner !== r.owner) throw new UserError("That account does not own this receipt", 403);
    if (!(await ensureSigner(auth.owner))) throw new UserError("This demo does not hold the key for that account. Sign the call from your own wallet.", 403);
    return { signer: auth.owner };
  }
  if (r.claimed) throw new UserError("This receipt was claimed to a NEAR account; its owner must act on it", 403);
  return { signer: getConfig().relayer, secret: auth };
}

export async function requestRefund(id: string, amount: string | undefined, auth: HolderAuth, reason = "refund") {
  const r = await mustGet(id);
  if (r.kind !== "OneTime") throw new UserError("Subscriptions and schedules are cancelled, not refunded");
  const amt = amount ?? refundable(r);
  if (!/^\d+$/.test(amt) || BigInt(amt) <= 0n) throw new UserError("Nothing is left to refund on this receipt", 409);
  const { signer, secret } = await holderSigner(r, auth);
  const tx = await run(() => getChain().requestRefund(signer, id, amt, secret));
  return afterRequest(id, amt, reason, tx.txHash, "refund.requested");
}

export async function cancelReceipt(id: string, auth: HolderAuth) {
  const r = await mustGet(id);
  if (r.kind === "OneTime") throw new UserError("One-time payments are refunded, not cancelled");
  const { signer, secret } = await holderSigner(r, auth);
  const tx = await run(() => getChain().cancel(signer, id, secret));
  const after = await mustGet(id);
  return afterRequest(id, after.pendingRefund, "cancel", tx.txHash, "subscription.cancelled");
}

async function afterRequest(id: string, amount: string, reason: string, txHash: string, event: "refund.requested" | "subscription.cancelled") {
  const r = await mustGet(id);
  const needsApproval = r.status === "PendingApproval";
  const job = await db.refundJob.create({ data: { receiptId: id, amount, reason, status: needsApproval ? "pending_approval" : "requested" } });
  await db.session.updateMany({ where: { receiptId: id }, data: { status: "refund_requested" } });
  await db.chainEvent.create({ data: { receiptId: id, event: reason === "cancel" ? "cancelled" : "refund_requested", dataJson: JSON.stringify({ amount, needsApproval }), txHash } });
  await enqueueWebhook(r.merchantId, event, { receiptId: id, orderRef: r.orderRef, amount, needsApproval });
  return { receipt: r, jobId: job.id, needsApproval };
}

export async function claimReceipt(id: string, secret: string, accountName: string) {
  const r = await mustGet(id);
  if (r.claimed) throw new UserError("This receipt was already claimed", 409);
  if (!HEX64.test(secret)) throw new UserError("Invalid secret", 401);
  const chain = getChain();
  let account = accountName.trim().toLowerCase();
  if (!(account.includes(".") && (await chain.accountExists(account)))) account = await ensureDemoAccount(account);
  const tx = await run(() => chain.claim(getConfig().relayer, id, secret, account));
  await db.chainEvent.create({ data: { receiptId: id, event: "claimed", dataJson: JSON.stringify({ account }), txHash: tx.txHash } });
  return { receipt: await mustGet(id), account };
}

export async function setRefundTarget(id: string, owner: string, target: { chain: string; asset: string; address: string }) {
  const r = await mustGet(id);
  if (owner !== r.owner || !r.claimed) throw new UserError("Only the owner of a claimed receipt can change where refunds go", 403);
  if (!(await ensureSigner(owner))) throw new UserError("This demo does not hold the key for that account", 403);
  if (!target?.address || !target.asset || !target.chain) throw new UserError("target needs chain, asset and address");
  await run(() => getChain().setRefundTarget(owner, id, target));
  return mustGet(id);
}

/** Merchant approval of a refund above the guard threshold. Signed with the merchant's demo account. */
export async function decideRefund(id: string, approve: boolean) {
  const r = await mustGet(id);
  const m = await getChain().getMerchant(r.merchantId);
  if (!m) throw new UserError("Merchant not found", 404);
  if (!(await ensureSigner(m.approver))) throw new UserError("This demo does not hold the approver key. Approve from the approver's wallet.", 403);
  const tx = await run(() => (approve ? getChain().approveRefund(m.approver, id) : getChain().rejectRefund(m.approver, id)));
  await db.chainEvent.create({ data: { receiptId: id, event: approve ? "refund_approved" : "refund_rejected", dataJson: "{}", txHash: tx.txHash } });
  await db.refundJob.updateMany({ where: { receiptId: id, status: "pending_approval" }, data: { status: approve ? "requested" : "rejected" } });
  if (!approve) await syncSessionStatus(await mustGet(id));
  return mustGet(id);
}

/** Keep the off-chain session status in step with the receipt. */
export async function syncSessionStatus(r: Receipt): Promise<void> {
  const status =
    r.status === "Refunded" ? "refunded" : r.status === "Released" ? "released" : r.status === "RefundRequested" || r.status === "PendingApproval" ? "refund_requested" : "paid";
  await db.session.updateMany({ where: { receiptId: r.id, status: { not: status } }, data: { status } });
}

export interface OpenDisputeInput {
  message: string;
  imageName?: string;
  auth: HolderAuth;
}

/** AI refund agent entry point. A "refund" decision goes through the normal request_refund path (guard still applies). */
export async function openDispute(id: string, input: OpenDisputeInput): Promise<{ decision: Decision; needsApproval?: boolean }> {
  const message = String(input.message ?? "").trim().slice(0, 2000);
  if (!message) throw new UserError("Tell us what went wrong");
  const r = await mustGet(id);
  // Check the caller really holds the receipt before spending an inference call.
  await holderSigner(r, input.auth);
  const merchant = await db.merchant.findUnique({ where: { id: r.merchantId } });
  const session = await db.session.findFirst({ where: { receiptId: id } });
  const now = await getChain().now();
  const decision = await decideDispute(parsePolicy(merchant?.policyJson), {
    message,
    hasImage: !!input.imageName,
    refundable: refundable(r),
    ageDays: Math.max(0, (now.getTime() - new Date(r.createdAt).getTime()) / 86_400_000),
    product: session?.product ?? undefined,
  });
  await db.dispute.create({
    data: { receiptId: id, message, imageName: input.imageName?.slice(0, 120), category: decision.category, decision: decision.decision, amount: decision.amount, reason: decision.reason, engine: decision.engine },
  });
  if (decision.decision !== "refund") return { decision };
  const res = r.kind === "OneTime" ? await requestRefund(id, decision.amount, input.auth, "dispute") : await cancelReceipt(id, input.auth);
  return { decision, needsApproval: res.needsApproval };
}

/** Everything the receipt page needs. No secrets. */
export async function receiptView(id: string) {
  const chain = getChain();
  const r = await mustGet(id);
  const [session, merchant, jobs, disputes, events, now] = await Promise.all([
    db.session.findFirst({ where: { receiptId: id } }),
    db.merchant.findUnique({ where: { id: r.merchantId } }),
    db.refundJob.findMany({ where: { receiptId: id }, orderBy: { createdAt: "desc" } }),
    db.dispute.findMany({ where: { receiptId: id }, orderBy: { createdAt: "desc" } }),
    db.chainEvent.findMany({ where: { receiptId: id }, orderBy: { createdAt: "asc" } }),
    chain.now(),
  ]);
  return {
    receipt: r,
    refundable: refundable(r),
    chainNow: now.toISOString(),
    contract: chain.receipts,
    merchant: merchant ? { id: merchant.id, name: merchant.name, guardThreshold: merchant.guardThreshold } : { id: r.merchantId, name: r.merchantId, guardThreshold: "0" },
    product: session?.product ?? null,
    paidWith: session ? { symbol: session.originSymbol, chain: session.originChain, amountFormatted: session.amountInFormatted } : null,
    ownerIsDemoAccount: r.claimed ? await ensureSigner(r.owner) : false,
    refunds: jobs.map((j) => ({ id: j.id, amount: j.amount, status: j.status, reason: j.reason, amountOutFormatted: j.amountOutFormatted, txHash: j.txHash, error: j.error, createdAt: j.createdAt.toISOString() })),
    disputes: disputes.map((d) => ({ id: d.id, message: d.message, category: d.category, decision: d.decision, amount: d.amount, reason: d.reason, engine: d.engine, createdAt: d.createdAt.toISOString() })),
    events: events.map((e) => ({ event: e.event, data: JSON.parse(e.dataJson) as unknown, txHash: e.txHash, at: e.createdAt.toISOString() })),
    mode: getConfig().mode,
  };
}

/** Dashboard list: on-chain receipts joined with what the shop knows about each order. */
export async function merchantReceipts(merchantId: string) {
  const chain = getChain();
  const [receipts, sessions, disputes, now] = await Promise.all([
    chain.receiptsForMerchant(merchantId, 0, 200),
    db.session.findMany({ where: { merchantId, receiptId: { not: null } } }),
    db.dispute.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
    chain.now(),
  ]);
  const byReceipt = new Map(sessions.map((s) => [s.receiptId, s]));
  return {
    chainNow: now.toISOString(),
    receipts: receipts
      .map((r) => {
        const s = byReceipt.get(r.id);
        const d = disputes.find((x) => x.receiptId === r.id);
        return {
          ...r,
          refundable: refundable(r),
          product: s?.product ?? null,
          paidWith: s ? { symbol: s.originSymbol, chain: s.originChain, amountFormatted: s.amountInFormatted } : null,
          dispute: d ? { decision: d.decision, reason: d.reason, category: d.category, message: d.message, engine: d.engine } : null,
        };
      })
      .reverse(),
  };
}
