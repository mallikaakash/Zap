import { InMemoryKeyStore, Near, parseKey } from "near-kit";
import type {
  AiDecision,
  ChainEventLog,
  ContractConfig,
  Kind,
  MerchantConfig,
  MerchantState,
  MintArgs,
  Receipt,
  ReceiptStatus,
  RefundTarget,
  RequestState,
  TrancheState,
  TxResult,
} from "./types";

export interface ChainOptions {
  rpcUrl: string;
  networkId: string;
  receipts: string;
  usdc: string;
  /** accountId → "ed25519:…" secret key. Only the accounts this process signs for. */
  keys: Record<string, string>;
}

const GAS = { light: "30 Tgas", transfer: "120 Tgas", mint: "150 Tgas" } as const;

const nsToIso = (ns: string | number): string => new Date(Number(BigInt(ns) / 1_000_000n)).toISOString();
const isoToNs = (iso: string): string => (BigInt(new Date(iso).getTime()) * 1_000_000n).toString();

interface RawReceipt {
  id: number;
  owner_id: string;
  claimed: boolean;
  transferable: boolean;
  merchant_id: string;
  order_ref: string;
  amount: string;
  released: string;
  refunded: string;
  in_flight: string;
  kind: Kind;
  status: ReceiptStatus;
  window_end: string;
  created_at: string;
  confirmed: boolean;
  schedule: Array<{ at: string; amount: string; state: TrancheState }>;
  refund_target: RefundTarget;
  receipt_key: string | null;
  nonce: number;
  request: null | {
    amount: string;
    reason_hash: string;
    summary_hash: string | null;
    opened_at: string;
    decision_deadline: string;
    veto_until: string | null;
    appealed: boolean;
    is_cancel: boolean;
    by_merchant: boolean;
    state: RequestState;
  };
}

interface RawMerchant {
  payout: string;
  approver: string;
  guard_threshold: string;
  default_window_secs: number;
  response_secs: number;
  daily_refund_cap: string;
  ai_triage: boolean;
  auto_approve_max: string;
  veto_secs: number;
  storage_balance: string;
  refunded_today: string;
  receipt_count: number;
}

function normalize(r: RawReceipt): Receipt {
  const q = r.request;
  return {
    id: String(r.id),
    merchantId: r.merchant_id,
    orderRef: r.order_ref,
    amount: r.amount,
    released: r.released,
    refunded: r.refunded,
    inFlight: r.in_flight,
    kind: r.kind,
    status: r.status,
    windowEnd: nsToIso(r.window_end),
    createdAt: nsToIso(r.created_at),
    confirmed: r.confirmed,
    schedule: r.schedule.map((t) => ({ at: nsToIso(t.at), amount: t.amount, state: t.state })),
    refundTarget: r.refund_target,
    owner: r.owner_id,
    claimed: r.claimed,
    transferable: r.transferable,
    receiptKey: r.receipt_key,
    nonce: r.nonce,
    request: q && {
      amount: q.amount,
      reasonHash: q.reason_hash,
      summaryHash: q.summary_hash,
      openedAt: nsToIso(q.opened_at),
      decisionDeadline: nsToIso(q.decision_deadline),
      vetoUntil: q.veto_until ? nsToIso(q.veto_until) : null,
      appealed: q.appealed,
      isCancel: q.is_cancel,
      byMerchant: q.by_merchant,
      state: q.state,
    },
  };
}

function mintArgsJson(a: MintArgs, withAmount: boolean): Record<string, unknown> {
  return {
    merchant_id: a.merchantId,
    order_ref: a.orderRef,
    ...(withAmount ? { amount: a.amount } : {}),
    kind: a.kind,
    window_secs: a.windowSecs ?? null,
    schedule: a.schedule.map((t) => ({ at: isoToNs(t.at), amount: t.amount })),
    refund_target: a.refundTarget ?? null,
    receipt_key: a.receiptKey ?? null,
    transferable: a.transferable ?? null,
  };
}

/** Pull NEP-297 events out of transaction logs. */
export function parseEvents(logs: string[]): ChainEventLog[] {
  const out: ChainEventLog[] = [];
  for (const line of logs) {
    if (!line.startsWith("EVENT_JSON:")) continue;
    try {
      const e = JSON.parse(line.slice("EVENT_JSON:".length)) as { standard?: string; event?: string; data?: unknown };
      if (e.standard !== "universal_checkout" || !e.event) continue;
      const data = Array.isArray(e.data) ? e.data[0] : e.data;
      out.push({ event: e.event, data: (data ?? {}) as Record<string, unknown> });
    } catch {
      // not ours
    }
  }
  return out;
}

/** A contract panic or failed cross-contract step, with the contract's own message. */
export class ChainError extends Error {
  constructor(message: string, readonly logs: string[] = []) {
    super(message);
    this.name = "ChainError";
  }
}

function cleanPanic(e: unknown): string {
  const raw = (e as { panic?: string })?.panic ?? (e instanceof Error ? e.message : String(e));
  const m = raw.match(/Smart contract panicked: (.*?)(?:["}]|$)/);
  return (m?.[1] ?? raw).trim();
}

export class Chain {
  readonly near: Near;
  readonly receipts: string;
  readonly usdc: string;
  readonly rpcUrl: string;
  readonly networkId: string;
  private readonly keys = new Set<string>();
  private readonly keyStore: InMemoryKeyStore;

  constructor(opts: ChainOptions) {
    this.receipts = opts.receipts;
    this.usdc = opts.usdc;
    this.rpcUrl = opts.rpcUrl;
    this.networkId = opts.networkId;
    this.keyStore = new InMemoryKeyStore(opts.keys);
    for (const id of Object.keys(opts.keys)) this.keys.add(id);
    this.near = new Near({ network: { rpcUrl: opts.rpcUrl, networkId: opts.networkId }, keyStore: this.keyStore });
  }

  canSignFor(accountId: string): boolean {
    return this.keys.has(accountId);
  }

  // ---------- low level ----------

  async view<T>(contract: string, method: string, args: object = {}): Promise<T> {
    return (await this.near.view<T>(contract, method, args, { finality: "optimistic" })) as T;
  }

  private readonly queues = new Map<string, Promise<unknown>>();

  /** Run sends for one signer strictly one after another, so access-key nonces never collide. */
  private serial<T>(signer: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(signer) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.queues.set(signer, next.catch(() => undefined));
    return next;
  }

  /** Send one function call and wait for the whole receipt tree (callbacks included). */
  call<T = unknown>(signer: string, contract: string, method: string, args: object, opts: { gas?: string; deposit?: string } = {}): Promise<TxResult<T>> {
    return this.serial(signer, () => this.callNow<T>(signer, contract, method, args, opts));
  }

  private async callNow<T = unknown>(signer: string, contract: string, method: string, args: object, opts: { gas?: string; deposit?: string } = {}): Promise<TxResult<T>> {
    if (!this.canSignFor(signer)) throw new ChainError(`No key available for ${signer}`);
    let outcome;
    try {
      outcome = await this.near
        .transaction(signer)
        .functionCall(contract, method, args, { gas: (opts.gas ?? GAS.light) as never, ...(opts.deposit ? { attachedDeposit: opts.deposit as never } : {}) })
        .send();
    } catch (e) {
      throw new ChainError(cleanPanic(e), (e as { logs?: string[] })?.logs ?? []);
    }
    const o = outcome as unknown as {
      status?: { SuccessValue?: string; Failure?: unknown };
      transaction?: { hash?: string };
      transaction_outcome?: { id?: string };
      receipts_outcome?: Array<{ outcome: { logs: string[]; status?: { Failure?: unknown } } }>;
    };
    const logs = (o.receipts_outcome ?? []).flatMap((r) => r.outcome.logs);
    if (o.status?.Failure) throw new ChainError(cleanPanic(new Error(JSON.stringify(o.status.Failure))), logs);
    let value: unknown = undefined;
    const sv = o.status?.SuccessValue;
    if (sv) {
      try {
        value = JSON.parse(Buffer.from(sv, "base64").toString("utf8"));
      } catch {
        value = undefined;
      }
    }
    return { txHash: o.transaction?.hash ?? o.transaction_outcome?.id ?? "", value: value as T, events: parseEvents(logs), logs };
  }

  /** Chain time (latest block), which is what the contract's windows and tranches are measured against. */
  async now(): Promise<Date> {
    const block = (await this.near.rpc.getBlock({ finality: "optimistic" })) as unknown as { header: { timestamp_nanosec?: string; timestamp: number } };
    const ns = block.header.timestamp_nanosec ?? String(block.header.timestamp);
    return new Date(Number(BigInt(ns) / 1_000_000n));
  }

  // ---------- views ----------

  async getReceipt(id: string): Promise<Receipt | null> {
    const r = await this.view<RawReceipt | null>(this.receipts, "get_receipt", { id: Number(id) });
    return r ? normalize(r) : null;
  }

  async getReceiptByOrderRef(orderRef: string): Promise<Receipt | null> {
    const r = await this.view<RawReceipt | null>(this.receipts, "get_receipt_by_order_ref", { order_ref: orderRef });
    return r ? normalize(r) : null;
  }

  /** Oldest first. The contract returns at most 100 per call, so this pages until `max` or the end. */
  async receiptsForMerchant(merchantId: string, fromIndex = 0, max = 100): Promise<Receipt[]> {
    const out: Receipt[] = [];
    while (out.length < max) {
      const limit = Math.min(100, max - out.length);
      const rows = (await this.view<RawReceipt[]>(this.receipts, "receipts_for_merchant", { merchant_id: merchantId, from_index: fromIndex + out.length, limit })) ?? [];
      out.push(...rows.map(normalize));
      if (rows.length < limit) break;
    }
    return out;
  }

  async receiptsForOwner(accountId: string, fromIndex = 0, limit = 100): Promise<Receipt[]> {
    const rows = await this.view<RawReceipt[]>(this.receipts, "receipts_for_owner", { account_id: accountId, from_index: fromIndex, limit });
    return (rows ?? []).map(normalize);
  }

  async getMerchant(id: string): Promise<MerchantState | null> {
    const m = await this.view<RawMerchant | null>(this.receipts, "get_merchant", { id });
    return m
      ? {
          payout: m.payout,
          approver: m.approver,
          guardThreshold: m.guard_threshold,
          defaultWindowSecs: m.default_window_secs,
          responseSecs: m.response_secs,
          dailyRefundCap: m.daily_refund_cap,
          aiTriage: m.ai_triage,
          autoApproveMax: m.auto_approve_max,
          vetoSecs: m.veto_secs,
          storageBalance: m.storage_balance,
          refundedToday: m.refunded_today,
          receiptCount: m.receipt_count,
        }
      : null;
  }

  async getConfig(): Promise<ContractConfig> {
    const c = await this.view<{ usdc: string; executor: string; owner: string; allocated: string; in_flight_total: string; mint_lock: boolean; paused: boolean; receipt_count: number; receipt_storage_cost: string }>(
      this.receipts,
      "get_config",
    );
    return {
      usdc: c.usdc,
      executor: c.executor,
      owner: c.owner,
      allocated: c.allocated,
      inFlightTotal: c.in_flight_total,
      mintLock: c.mint_lock,
      paused: c.paused,
      receiptCount: c.receipt_count,
      receiptStorageCost: c.receipt_storage_cost,
    };
  }

  async usdcBalance(accountId: string): Promise<string> {
    return (await this.view<string>(this.usdc, "ft_balance_of", { account_id: accountId })) ?? "0";
  }

  /** USDC sitting in the receipt contract that no receipt has claimed yet. */
  async unassignedUsdc(): Promise<string> {
    const [bal, cfg] = await Promise.all([this.usdcBalance(this.receipts), this.getConfig()]);
    const free = BigInt(bal) - BigInt(cfg.allocated) - BigInt(cfg.inFlightTotal);
    return (free > 0n ? free : 0n).toString();
  }

  async accountExists(accountId: string): Promise<boolean> {
    return this.near.accountExists(accountId);
  }

  // ---------- receipt contract calls ----------

  /** `storageNear` (e.g. "0.5 NEAR") tops up the merchant's prepaid receipt storage. */
  registerMerchant(merchantId: string, m: MerchantConfig, storageNear?: string) {
    return this.call(
      merchantId,
      this.receipts,
      "register_merchant",
      {
        payout: m.payout,
        approver: m.approver,
        guard_threshold: m.guardThreshold,
        default_window_secs: m.defaultWindowSecs,
        response_secs: m.responseSecs,
        daily_refund_cap: m.dailyRefundCap,
        ai_triage: m.aiTriage,
        auto_approve_max: m.autoApproveMax,
        veto_secs: m.vetoSecs,
      },
      { deposit: storageNear },
    );
  }

  /**
   * Operator registration (owner or executor): a seller signs up with just a payout account and never signs anything.
   * `storageNear` is added to that seller's prepaid receipt storage.
   */
  registerMerchantFor(signer: string, merchantId: string, m: MerchantConfig, storageNear?: string) {
    return this.call(
      signer,
      this.receipts,
      "register_merchant_for",
      {
        merchant_id: merchantId,
        payout: m.payout,
        approver: m.approver,
        guard_threshold: m.guardThreshold,
        default_window_secs: m.defaultWindowSecs,
        response_secs: m.responseSecs,
        daily_refund_cap: m.dailyRefundCap,
        ai_triage: m.aiTriage,
        auto_approve_max: m.autoApproveMax,
        veto_secs: m.vetoSecs,
      },
      { deposit: storageNear },
    );
  }

  /** Primary path: the swap already paid the contract; attribute that money to an order. Executor only. */
  mintReceipt(executor: string, a: MintArgs) {
    return this.call<number>(executor, this.receipts, "mint_receipt", { args: mintArgsJson(a, true) }, { gas: GAS.mint });
  }

  /** Direct USDC path: `ft_transfer_call` to the contract; the receipt is minted in `ft_on_transfer`. Any sender. */
  payDirect(sender: string, a: MintArgs) {
    return this.call<string>(sender, this.usdc, "ft_transfer_call", { receiver_id: this.receipts, amount: a.amount, msg: JSON.stringify(mintArgsJson(a, false)) }, { gas: GAS.mint, deposit: "1 yocto" });
  }

  /** Renew a pass: append a tranche to an existing Subscription/Schedule receipt. */
  topUp(sender: string, id: string, amount: string, at?: string) {
    return this.call<string>(sender, this.usdc, "ft_transfer_call", { receiver_id: this.receipts, amount, msg: JSON.stringify({ topup_of: Number(id), ...(at ? { at: isoToNs(at) } : {}) }) }, { gas: GAS.mint, deposit: "1 yocto" });
  }

  /** Resolves to `false` in `value` when the USDC transfer failed and the contract rolled back. */
  release(signer: string, id: string) {
    return this.call<boolean>(signer, this.receipts, "release", { id: Number(id) }, { gas: GAS.transfer });
  }

  /** `sig` = receipt-key signature for unclaimed receipts; omit when `signer` is the NFT owner. */
  requestRefund(signer: string, id: string, amount: string, reasonHash: string, sig?: string) {
    return this.call(signer, this.receipts, "request_refund", { id: Number(id), amount, reason_hash: reasonHash, sig: sig ?? null });
  }

  cancel(signer: string, id: string, reasonHash: string, sig?: string) {
    return this.call(signer, this.receipts, "cancel", { id: Number(id), reason_hash: reasonHash, sig: sig ?? null });
  }

  aiDecide(executor: string, id: string, decision: AiDecision, amount: string, summaryHash: string) {
    return this.call(executor, this.receipts, "ai_decide", { id: Number(id), decision, amount, summary_hash: summaryHash });
  }

  veto(approver: string, id: string, note: string) {
    return this.call(approver, this.receipts, "veto", { id: Number(id), note });
  }

  appeal(signer: string, id: string, sig?: string) {
    return this.call(signer, this.receipts, "appeal", { id: Number(id), sig: sig ?? null });
  }

  approveRefund(approver: string, id: string) {
    return this.call(approver, this.receipts, "approve_refund", { id: Number(id) });
  }

  rejectRefund(approver: string, id: string, note: string) {
    return this.call(approver, this.receipts, "reject_refund", { id: Number(id), note });
  }

  finalizeRequest(signer: string, id: string) {
    return this.call(signer, this.receipts, "finalize_request", { id: Number(id) });
  }

  merchantRefund(approver: string, id: string, amount: string) {
    return this.call(approver, this.receipts, "merchant_refund", { id: Number(id), amount });
  }

  confirmReceived(signer: string, id: string, sig?: string) {
    return this.call(signer, this.receipts, "confirm_received", { id: Number(id), sig: sig ?? null });
  }

  /** Throws if the USDC transfer failed (the contract has already rolled the refund back to `Approved`). */
  async executeRefund(executor: string, id: string, depositAccount: string, amount: string, quoteId: string) {
    const tx = await this.call<boolean>(executor, this.receipts, "execute_refund", { id: Number(id), deposit_account: depositAccount, amount, quote_id: quoteId.slice(0, 128) }, { gas: GAS.transfer });
    if (tx.value === false) throw new ChainError("The USDC transfer for this refund failed and was rolled back; it will be retried", tx.logs);
    return tx;
  }

  claim(signer: string, id: string, account: string, sig: string) {
    return this.call(signer, this.receipts, "claim", { id: Number(id), account, sig });
  }

  setRefundTarget(signer: string, id: string, target: RefundTarget, sig?: string) {
    return this.call(signer, this.receipts, "set_refund_target", { id: Number(id), target, sig: sig ?? null });
  }

  /** Standard NEP-171 transfer (only for transferable receipts). */
  nftTransfer(owner: string, id: string, receiver: string) {
    return this.call(owner, this.receipts, "nft_transfer", { receiver_id: receiver, token_id: id }, { deposit: "1 yocto" });
  }

  pause(owner: string, paused: boolean) {
    return this.call(owner, this.receipts, paused ? "pause" : "unpause", {});
  }

  // ---------- USDC ----------

  /** Register `accountId` with the USDC contract if needed, so it can receive transfers. */
  async ensureUsdcStorage(payer: string, accountId: string): Promise<void> {
    const bal = await this.view<{ total: string } | null>(this.usdc, "storage_balance_of", { account_id: accountId });
    if (bal) return;
    await this.call(payer, this.usdc, "storage_deposit", { account_id: accountId, registration_only: true }, { deposit: "0.00125 NEAR" });
  }

  /** Mock USDC only (sandbox / testnet faucet token). */
  mintMockUsdc(signer: string, accountId: string, amount: string) {
    return this.call(signer, this.usdc, "mint", { account_id: accountId, amount });
  }

  // ---------- sandbox only ----------

  private async rpcRaw(method: string, params: unknown): Promise<unknown> {
    const res = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "uc", method, params }),
    });
    const body = (await res.json()) as { result?: unknown; error?: { message?: string; data?: unknown } };
    if (body.error) throw new ChainError(`${method}: ${body.error.message ?? "RPC error"} ${JSON.stringify(body.error.data ?? "")}`);
    return body.result;
  }

  /** Jump chain time forward (local sandbox only). The sandbox advances roughly one second per block. */
  async fastForward(seconds: number): Promise<void> {
    if (this.networkId !== "localnet") throw new ChainError("Time travel only works on the local sandbox");
    const target = (await this.now()).getTime() + seconds * 1000;
    let blocks = Math.max(1, Math.ceil(seconds));
    for (let i = 0; i < 6; i++) {
      await this.rpcRaw("sandbox_fast_forward", { delta_height: blocks });
      // fast-forward is applied asynchronously; wait until block time catches up
      for (let w = 0; w < 100; w++) {
        const now = (await this.now()).getTime();
        if (now >= target) return;
        await new Promise((r) => setTimeout(r, 200));
        if (w === 99) blocks = Math.max(1, Math.ceil((target - now) / 1000));
      }
    }
  }

  /** Create a named account funded by `parent` (sandbox: `<name>.test.near`). Returns nothing if it already exists. */
  async createSubAccount(parent: string, accountId: string, publicKey: string, secretKey: string, near = "5 NEAR"): Promise<void> {
    if (await this.accountExists(accountId)) {
      await this.addKey(accountId, secretKey);
      return;
    }
    await this.near
      .transaction(parent)
      .createAccount(accountId)
      .transfer(accountId, near as never)
      .addKey(publicKey, { type: "fullAccess" } as never)
      .send();
    await this.addKey(accountId, secretKey);
  }

  async addKey(accountId: string, secretKey: string): Promise<void> {
    await this.keyStore.add(accountId, parseKey(secretKey));
    this.keys.add(accountId);
  }
}
