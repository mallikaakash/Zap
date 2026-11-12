import { createHash } from "node:crypto";
import { db, type RefundCase } from "@uc/db";
import { ACTIVE_REQUEST_STATES, ChainError, isSignature, verifyReceiptAction, type Receipt, type RefundTarget } from "@uc/chain";
import { UserError } from "./errors";
import { MAX_ROUNDS, parsePolicy, triage, type ChatMessage, type Decision } from "./refund-agent";
import { ensureDemoAccount, ensureSigner, getChain, getConfig } from "./runtime";
import { validateAddress } from "./sessions";
import { enqueueWebhook } from "./webhooks";

/**
 * How a caller proves they hold the receipt.
 * - `{ sig }`: unclaimed receipt — a receipt-key signature made in the browser. The server only relays it.
 * - `{ owner }`: claimed receipt held by a demo-custodial account (local/testnet demo only).
 */
export type HolderAuth = { sig: string } | { owner: string };

export function parseAuth(body: Record<string, unknown>): HolderAuth {
  if (typeof body.owner === "string" && body.owner) return { owner: body.owner };
  if (isSignature(body.sig)) return { sig: body.sig };
  throw new UserError("Provide either { sig } (a receipt-key signature, 128 hex chars) or { owner }", 401);
}

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

export async function mustGet(id: string): Promise<Receipt> {
  if (!/^\d+$/.test(id)) throw new UserError("Receipt not found", 404);
  const r = await getChain().getReceipt(id);
  if (!r) throw new UserError("Receipt not found", 404);
  return r;
}

export const requestActive = (r: Receipt): boolean => !!r.request && ACTIVE_REQUEST_STATES.includes(r.request.state);

/** Money a holder could ask back right now: unreleased, unrefunded, and not already in a request. */
export function refundable(r: Receipt, now: Date): string {
  if (requestActive(r) || BigInt(r.inFlight) > 0n) return "0";
  if (r.kind === "OneTime") {
    if (r.confirmed || now >= new Date(r.windowEnd)) return "0";
    return (BigInt(r.amount) - BigInt(r.released) - BigInt(r.refunded)).toString();
  }
  return r.schedule.filter((t) => t.state === "Pending" && new Date(t.at) > now).reduce((a, t) => a + BigInt(t.amount), 0n).toString();
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ChainError) throw new UserError(e.message, 409);
    throw e;
  }
}

/** Who sends a holder call: the relayer for signed calls, the owner's demo account otherwise. */
async function holderSigner(r: Receipt, auth: HolderAuth): Promise<{ signer: string; sig?: string }> {
  if ("owner" in auth) {
    if (!r.claimed || auth.owner !== r.owner) throw new UserError("That account does not own this receipt", 403);
    if (!(await ensureSigner(auth.owner))) throw new UserError("This demo does not hold the key for that account. Sign the call from your own wallet.", 403);
    return { signer: auth.owner };
  }
  if (r.claimed) throw new UserError("This receipt was claimed to a NEAR account; its owner must act on it", 403);
  return { signer: getConfig().relayer, sig: auth.sig };
}

const msg = (role: ChatMessage["role"], text: string, imageName?: string): ChatMessage => ({ role, text, ...(imageName ? { imageName } : {}), at: new Date().toISOString() });
const messagesOf = (c: RefundCase): ChatMessage[] => JSON.parse(c.messagesJson) as ChatMessage[];

/** Refund-abuse guard (SPEC §9c #11): blocklist and a cap on recent requests per refund address. */
async function checkAbuse(merchantId: string, address: string): Promise<number> {
  const merchant = await db.merchant.findUnique({ where: { id: merchantId } });
  const blocked = JSON.parse(merchant?.blockedRefundAddresses || "[]") as string[];
  if (blocked.includes(address.toLowerCase())) throw new UserError("Refund requests from this address are not accepted by the shop. Contact the shop directly.", 403);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const recent = await db.refundCase.count({ where: { merchantId, refundAddress: address, createdAt: { gte: since }, kind: { not: "merchant" } } });
  if (recent >= 5) throw new UserError("Too many refund requests from this address recently. Contact the shop directly.", 429);
  return recent;
}

export interface RefundInput {
  /** Minor units; defaults to everything refundable. Must be the amount the signature covers. */
  amount?: string;
  reason: string;
  imageName?: string;
  auth: HolderAuth;
}

/** Customer opens a refund request (OneTime) or cancels a pass (Subscription/Schedule). Release is blocked while it is open. */
export async function openRequest(id: string, kind: "refund" | "cancel", input: RefundInput) {
  const reason = String(input.reason ?? "").trim().slice(0, 2000);
  if (reason.length < 3) throw new UserError("Tell us briefly what went wrong");
  const chain = getChain();
  const r = await mustGet(id);
  if (kind === "refund" && r.kind !== "OneTime") throw new UserError("Subscriptions and schedules are cancelled, not refunded");
  if (kind === "cancel" && r.kind === "OneTime") throw new UserError("One-time payments are refunded, not cancelled");
  const available = refundable(r, await chain.now());
  if (BigInt(available) === 0n) throw new UserError(requestActive(r) ? "A request is already open on this receipt" : "Nothing is left to refund on this receipt", 409);
  const amount = kind === "cancel" ? available : (input.amount ?? available);
  if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n || BigInt(amount) > BigInt(available)) throw new UserError("That amount is not available to refund");
  await checkAbuse(r.merchantId, r.refundTarget.address);
  const { signer, sig } = await holderSigner(r, input.auth);
  const reasonHash = sha256(reason);
  const tx = await run(() => (kind === "refund" ? chain.requestRefund(signer, id, amount, reasonHash, sig) : chain.cancel(signer, id, reasonHash, sig)));

  const merchant = await db.merchant.findUnique({ where: { id: r.merchantId } });
  const c = await db.refundCase.create({
    data: {
      receiptId: id,
      merchantId: r.merchantId,
      kind,
      amount,
      reason,
      refundAddress: r.refundTarget.address,
      messagesJson: JSON.stringify([msg("customer", reason, input.imageName)]),
      aiState: merchant?.aiTriage ? "asking" : "none",
    },
  });
  await db.session.updateMany({ where: { receiptId: id }, data: { status: "refund_requested" } });
  await db.chainEvent.create({ data: { receiptId: id, event: kind === "cancel" ? "cancelled" : "refund_requested", dataJson: JSON.stringify({ amount }), txHash: tx.txHash } });
  await enqueueWebhook(r.merchantId, kind === "cancel" ? "subscription.cancelled" : "refund.requested", { receiptId: id, orderRef: await orderRefOf(id), amount, reason });
  if (merchant?.aiTriage) await runTriage(c.id);
  else await addMessage(c.id, msg("system", "Your request was sent to the shop. If they do not answer in time it is approved automatically."));
  return caseView(await db.refundCase.findUniqueOrThrow({ where: { id: c.id } }));
}

async function orderRefOf(receiptId: string): Promise<string | null> {
  return (await db.session.findFirst({ where: { receiptId } }))?.orderRef ?? null;
}

async function addMessage(caseId: string, m: ChatMessage, extra: Partial<RefundCase> = {}): Promise<void> {
  const c = await db.refundCase.findUniqueOrThrow({ where: { id: caseId } });
  await db.refundCase.update({ where: { id: caseId }, data: { messagesJson: JSON.stringify([...messagesOf(c), m]), ...extra } });
}

/**
 * One turn of the triage agent. Produces a clarifying question, or a decision that the
 * settlement worker (the only holder of the executor key) then posts on chain as `ai_decide`.
 */
export async function runTriage(caseId: string, forceDecision = false): Promise<void> {
  const c = await db.refundCase.findUniqueOrThrow({ where: { id: caseId } });
  if (c.aiState !== "asking") return;
  const chain = getChain();
  const r = await mustGet(c.receiptId);
  if (r.request?.state !== "Open") return;
  const [merchant, session, prior, now] = await Promise.all([
    db.merchant.findUnique({ where: { id: c.merchantId } }),
    db.session.findFirst({ where: { receiptId: c.receiptId } }),
    db.refundCase.count({ where: { merchantId: c.merchantId, refundAddress: c.refundAddress, id: { not: c.id }, kind: { not: "merchant" } } }),
    chain.now(),
  ]);
  if (!merchant) return;
  const policy = parsePolicy(merchant.policyJson);
  const result = await triage({
    policy,
    limits: { requested: r.request.amount, autoApproveMax: merchant.autoApproveMax, guardThreshold: merchant.guardThreshold, partialAllowed: !r.request.isCancel },
    product: session?.product ?? undefined,
    kind: r.kind,
    ageDays: Math.max(0, (now.getTime() - new Date(r.createdAt).getTime()) / 86_400_000),
    fulfilment: (session?.fulfilment ?? "none") as never,
    trackingUrl: session?.trackingUrl ?? undefined,
    priorRequests: prior,
    messages: messagesOf(c),
    rounds: c.rounds,
    forceDecision: forceDecision || c.rounds >= MAX_ROUNDS,
  });
  if (result.type === "ask") {
    await addMessage(caseId, msg("agent", result.question), { rounds: c.rounds + 1, customerDeadline: new Date(Date.now() + policy.customerReplyHours * 3_600_000) });
    return;
  }
  const { type: _t, ...decision } = result;
  const transcript = [...messagesOf(c)];
  const summaryHash = sha256(JSON.stringify({ summary: decision.summary, transcript }));
  const text: Record<Decision["decision"], string> = {
    approve: "Approved. The shop has a short window to object; after that your refund is sent automatically.",
    partial: "A partial refund was approved. The shop has a short window to object; after that it is sent automatically.",
    escalate: "I've passed this to the shop with a summary. If they do not answer in time, your refund is approved automatically.",
    deny: "This request falls outside the shop's refund policy, so I can't approve it. You can appeal once and the shop will review it.",
  };
  await addMessage(caseId, msg("agent", `${text[decision.decision]}\n\n${decision.summary}`), { aiState: "decided", decisionJson: JSON.stringify(decision), summaryHash, customerDeadline: null });
}

export interface MessageInput {
  text: string;
  imageName?: string;
  /** `{ sig }` signs action "message" with bodyHash = sha256(text), at the receipt's current nonce. */
  auth: HolderAuth;
}

/** Customer replies in the refund chat (answers a clarifying question, adds a photo). */
export async function postMessage(id: string, input: MessageInput) {
  const text = String(input.text ?? "").trim().slice(0, 2000);
  if (!text && !input.imageName) throw new UserError("Write a message or attach a photo");
  const r = await mustGet(id);
  if ("owner" in input.auth) await holderSigner(r, input.auth);
  else {
    if (r.claimed || !r.receiptKey) throw new UserError("This receipt was claimed; its owner must act on it", 403);
    const ok = await verifyReceiptAction(r.receiptKey, input.auth.sig, getChain().receipts, id, r.nonce, { action: "message", bodyHash: sha256(text) }).catch(() => false);
    if (!ok) throw new UserError("That message was not signed by this receipt's key", 401);
  }
  const c = await db.refundCase.findFirst({ where: { receiptId: id, closed: false }, orderBy: { createdAt: "desc" } });
  if (!c) throw new UserError("There is no open request on this receipt", 409);
  await addMessage(c.id, msg("customer", text || "(photo)", input.imageName?.slice(0, 120)));
  if (c.aiState === "asking") await runTriage(c.id);
  return caseView(await db.refundCase.findUniqueOrThrow({ where: { id: c.id } }));
}

export async function appealRequest(id: string, auth: HolderAuth) {
  const r = await mustGet(id);
  const { signer, sig } = await holderSigner(r, auth);
  const tx = await run(() => getChain().appeal(signer, id, sig));
  const c = await db.refundCase.findFirst({ where: { receiptId: id }, orderBy: { createdAt: "desc" } });
  if (c) await addMessage(c.id, msg("system", "You appealed. The shop will review this request; if they do not answer in time it is approved automatically."), { closed: false });
  await db.chainEvent.create({ data: { receiptId: id, event: "appealed", dataJson: "{}", txHash: tx.txHash } });
  await enqueueWebhook(r.merchantId, "refund.escalated", { receiptId: id, orderRef: await orderRefOf(id), amount: r.request?.amount, appealed: true });
  return mustGet(id);
}

export async function confirmReceived(id: string, auth: HolderAuth) {
  const r = await mustGet(id);
  const { signer, sig } = await holderSigner(r, auth);
  const tx = await run(() => getChain().confirmReceived(signer, id, sig));
  await db.chainEvent.create({ data: { receiptId: id, event: "confirmed", dataJson: "{}", txHash: tx.txHash } });
  return mustGet(id);
}

/** Resolve the account a claim will go to (so the browser can sign it). Creates a demo account when given a plain name. */
export async function prepareClaimAccount(name: string): Promise<string> {
  const account = String(name ?? "").trim().toLowerCase();
  if (account.includes(".") && (await getChain().accountExists(account))) return account;
  return ensureDemoAccount(account);
}

export async function claimReceipt(id: string, account: string, sig: string) {
  const r = await mustGet(id);
  if (r.claimed) throw new UserError("This receipt was already claimed", 409);
  if (!isSignature(sig)) throw new UserError("Invalid signature", 401);
  const chain = getChain();
  if (!(await chain.accountExists(account))) throw new UserError(`${account} does not exist on ${getConfig().networkId}`);
  const tx = await run(() => chain.claim(getConfig().relayer, id, account, sig));
  await db.chainEvent.create({ data: { receiptId: id, event: "claimed", dataJson: JSON.stringify({ account }), txHash: tx.txHash } });
  return { receipt: await mustGet(id), account };
}

export async function setRefundTarget(id: string, target: RefundTarget, auth: HolderAuth) {
  const r = await mustGet(id);
  if (!target?.address || !target.asset || !target.chain) throw new UserError("target needs chain, asset and address");
  const bad = validateAddress(target.chain, target.address);
  if (bad) throw new UserError(bad);
  const { signer, sig } = await holderSigner(r, auth);
  const tx = await run(() => getChain().setRefundTarget(signer, id, target, sig));
  await db.chainEvent.create({ data: { receiptId: id, event: "refund_target_changed", dataJson: JSON.stringify(target), txHash: tx.txHash } });
  return mustGet(id);
}

/** Transfer a transferable receipt (a pass) to another account. Demo-custodial owners only. */
export async function transferReceipt(id: string, owner: string, to: string) {
  const r = await mustGet(id);
  await holderSigner(r, { owner });
  if (!r.transferable) throw new UserError("One-time receipts cannot be transferred");
  const receiver = await prepareClaimAccount(to);
  const tx = await run(() => getChain().nftTransfer(owner, id, receiver));
  await db.chainEvent.create({ data: { receiptId: id, event: "transferred", dataJson: JSON.stringify({ from: owner, to: receiver }), txHash: tx.txHash } });
  return { receipt: await mustGet(id), account: receiver };
}

// ---------- merchant actions (signed by the merchant's approver account) ----------

async function approverFor(r: Receipt): Promise<string> {
  const m = await getChain().getMerchant(r.merchantId);
  if (!m) throw new UserError("Merchant not found", 404);
  if (!(await ensureSigner(m.approver))) throw new UserError("This demo does not hold the approver key. Approve from the approver's own wallet.", 403);
  return m.approver;
}

export async function merchantDecide(id: string, action: "approve" | "reject" | "veto", note = "") {
  const r = await mustGet(id);
  const approver = await approverFor(r);
  const chain = getChain();
  const clean = note.trim().slice(0, 280);
  const tx = await run(() => (action === "approve" ? chain.approveRefund(approver, id) : action === "reject" ? chain.rejectRefund(approver, id, clean) : chain.veto(approver, id, clean)));
  const c = await db.refundCase.findFirst({ where: { receiptId: id, closed: false }, orderBy: { createdAt: "desc" } });
  const text = { approve: "The shop approved your refund. It is on its way.", reject: "The shop declined this request.", veto: "The shop asked to review this request before it is paid." }[action];
  if (c) await addMessage(c.id, msg("merchant", clean ? `${text}\n\n"${clean}"` : text));
  await db.chainEvent.create({ data: { receiptId: id, event: action === "approve" ? "refund_approved" : action === "reject" ? "refund_rejected" : "vetoed", dataJson: JSON.stringify({ note: clean }), txHash: tx.txHash } });
  if (action !== "veto") await enqueueWebhook(r.merchantId, action === "approve" ? "refund.approved" : "refund.rejected", { receiptId: id, orderRef: await orderRefOf(id), amount: r.request?.amount });
  return mustGet(id);
}

/** Merchant-initiated refund of unreleased funds: no customer key needed (lost link, goodwill, mispayment). */
export async function merchantRefund(id: string, amount?: string) {
  const chain = getChain();
  const r = await mustGet(id);
  const approver = await approverFor(r);
  const unreleased = r.kind === "OneTime" ? (BigInt(r.amount) - BigInt(r.released) - BigInt(r.refunded)).toString() : r.schedule.filter((t) => t.state === "Pending").reduce((a, t) => a + BigInt(t.amount), 0n).toString();
  const amt = r.kind === "OneTime" ? (amount ?? unreleased) : unreleased;
  if (!/^\d+$/.test(amt) || BigInt(amt) <= 0n || BigInt(amt) > BigInt(unreleased)) throw new UserError("That amount is not available to refund");
  const tx = await run(() => chain.merchantRefund(approver, id, amt));
  await db.refundCase.create({
    data: { receiptId: id, merchantId: r.merchantId, kind: "merchant", amount: amt, reason: "Refund started by the shop", refundAddress: r.refundTarget.address, messagesJson: JSON.stringify([msg("merchant", "The shop started a refund for this order.")]) },
  });
  await db.session.updateMany({ where: { receiptId: id }, data: { status: "refund_requested" } });
  await db.chainEvent.create({ data: { receiptId: id, event: "refund_approved", dataJson: JSON.stringify({ amount: amt, byMerchant: true }), txHash: tx.txHash } });
  return mustGet(id);
}

/** Keep the off-chain session status in step with the receipt. */
export async function syncSessionStatus(r: Receipt): Promise<void> {
  const settled = BigInt(r.released) + BigInt(r.refunded) === BigInt(r.amount);
  const status = requestActive(r) ? "refund_requested" : settled ? (BigInt(r.refunded) > 0n ? "refunded" : "released") : "paid";
  await db.session.updateMany({ where: { receiptId: r.id, status: { not: status } }, data: { status } });
}

// ---------- views ----------

export function caseView(c: RefundCase) {
  return {
    id: c.id,
    receiptId: c.receiptId,
    kind: c.kind,
    amount: c.amount,
    messages: messagesOf(c),
    rounds: c.rounds,
    aiState: c.aiState,
    decision: c.decisionJson ? (JSON.parse(c.decisionJson) as Decision) : null,
    summaryHash: c.summaryHash,
    customerDeadline: c.customerDeadline?.toISOString() ?? null,
    payoutState: c.payoutState,
    depositAddress: c.depositAddress,
    quoteId: c.quoteId,
    amountOutFormatted: c.amountOutFormatted,
    txHash: c.txHash,
    error: c.error,
    closed: c.closed,
    createdAt: c.createdAt.toISOString(),
  };
}

/** Everything the receipt page needs. Never contains a private key (the server never has one). */
export async function receiptView(id: string) {
  const chain = getChain();
  const r = await mustGet(id);
  const [session, merchant, cases, events, now] = await Promise.all([
    db.session.findFirst({ where: { receiptId: id } }),
    db.merchant.findUnique({ where: { id: r.merchantId } }),
    db.refundCase.findMany({ where: { receiptId: id }, orderBy: { createdAt: "desc" } }),
    db.chainEvent.findMany({ where: { receiptId: id }, orderBy: { createdAt: "asc" } }),
    chain.now(),
  ]);
  return {
    receipt: r,
    refundable: refundable(r, now),
    chainNow: now.toISOString(),
    contract: chain.receipts,
    usdc: chain.usdc,
    networkId: chain.networkId,
    merchant: { id: r.merchantId, name: merchant?.name ?? r.merchantId, aiTriage: merchant?.aiTriage ?? false },
    product: session?.product ?? null,
    orderRef: session?.orderRef ?? null,
    fulfilment: session?.fulfilment ?? "none",
    trackingUrl: session?.trackingUrl ?? null,
    paidWith: session ? { symbol: session.originSymbol, chain: session.originChain, amountFormatted: session.amountInFormatted, direct: session.direct } : null,
    ownerIsDemoAccount: r.claimed ? await ensureSigner(r.owner) : false,
    cases: cases.map(caseView),
    events: events.map((e) => ({ event: e.event, data: JSON.parse(e.dataJson) as unknown, txHash: e.txHash, at: e.createdAt.toISOString() })),
    mode: getConfig().mode,
  };
}

/** Dashboard list: on-chain receipts joined with what the shop knows about each order. */
export async function merchantReceipts(merchantId: string) {
  const chain = getChain();
  const [receipts, sessions, cases, now, onChain] = await Promise.all([
    chain.receiptsForMerchant(merchantId, 0, 200),
    db.session.findMany({ where: { merchantId, receiptId: { not: null } } }),
    db.refundCase.findMany({ where: { merchantId }, orderBy: { createdAt: "desc" }, take: 500 }),
    chain.now(),
    chain.getMerchant(merchantId),
  ]);
  const byReceipt = new Map(sessions.map((s) => [s.receiptId, s]));
  return {
    chainNow: now.toISOString(),
    onChain,
    receipts: receipts
      .map((r) => {
        const s = byReceipt.get(r.id);
        const c = cases.find((x) => x.receiptId === r.id);
        return {
          ...r,
          refundable: refundable(r, now),
          product: s?.product ?? null,
          orderRef: s?.orderRef ?? null,
          fulfilment: s?.fulfilment ?? "none",
          trackingUrl: s?.trackingUrl ?? null,
          paidWith: s ? { symbol: s.originSymbol, chain: s.originChain, amountFormatted: s.amountInFormatted, direct: s.direct } : null,
          case: c ? caseView(c) : null,
        };
      })
      .reverse(),
  };
}

/** Merchant tells us where the order is (also reachable from their own systems). The triage agent reads it. */
export async function setFulfilment(merchantId: string, orderRef: string, status: string, trackingUrl?: string | null) {
  if (!["none", "shipped", "delivered", "digital_accessed"].includes(status)) throw new UserError("status must be none, shipped, delivered or digital_accessed");
  if (trackingUrl && !/^https?:\/\//.test(trackingUrl)) throw new UserError("trackingUrl must be an http(s) URL");
  const res = await db.session.updateMany({ where: { merchantId, orderRef }, data: { fulfilment: status, ...(trackingUrl !== undefined ? { trackingUrl: trackingUrl || null } : {}) } });
  if (res.count === 0) throw new UserError("Order not found", 404);
  return { orderRef, fulfilment: status, trackingUrl: trackingUrl ?? null };
}

/**
 * Public verification (SPEC §9b "compromised executor"): for each refund paid out of a
 * receipt, show the quote and where the swap provider says the money is going, next to
 * the receipt's on-chain `refund_target`. Anyone can compare them.
 */
export async function verifyView(id: string) {
  const chain = getChain();
  const r = await mustGet(id);
  const [cases, session, cfg] = await Promise.all([db.refundCase.findMany({ where: { receiptId: id, payoutState: { not: "none" } }, orderBy: { createdAt: "asc" } }), db.session.findFirst({ where: { receiptId: id } }), chain.getConfig()]);
  return {
    receipt: r,
    contract: chain.receipts,
    networkId: chain.networkId,
    mode: getConfig().mode,
    attribution: session ? { orderRefHash: session.orderRefHash, matches: session.orderRefHash === r.orderRef, amountMatches: session.amount === r.amount, mintTxHash: session.mintTxHash, direct: session.direct } : null,
    contractTotals: { allocated: cfg.allocated, inFlightTotal: cfg.inFlightTotal, usdcBalance: await chain.usdcBalance(chain.receipts), paused: cfg.paused },
    refunds: cases.map((c) => {
      const quote = c.quoteJson ? (JSON.parse(c.quoteJson) as { raw?: { quoteRequest?: { recipient?: string; destinationAsset?: string } }; destinationAsset?: string }) : null;
      const recipient = quote?.raw?.quoteRequest?.recipient ?? (c.quoteId?.startsWith("direct") ? c.depositAddress : null);
      const mock = !!c.quoteId?.startsWith("mock");
      return {
        amount: c.amount,
        quoteId: c.quoteId,
        depositAccount: c.depositAddress,
        txHash: c.txHash,
        payoutState: c.payoutState,
        amountOutFormatted: c.amountOutFormatted,
        simulated: mock,
        quotedRecipient: mock ? r.refundTarget.address : recipient,
        quotedAsset: quote?.destinationAsset ?? null,
        recipientMatchesTarget: mock ? null : recipient ? recipient === r.refundTarget.address : null,
      };
    }),
  };
}
