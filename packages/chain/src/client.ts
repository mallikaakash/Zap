import { InMemoryKeyStore, Near, parseKey } from "near-kit";
import type {
  ChainEventLog,
  ContractConfig,
  Kind,
  MerchantConfig,
  MintArgs,
  Receipt,
  ReceiptStatus,
  RefundTarget,
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

const GAS = { light: "30 Tgas", transfer: "100 Tgas", mint: "100 Tgas" } as const;

const nsToIso = (ns: string | number): string => new Date(Number(BigInt(ns) / 1_000_000n)).toISOString();
const isoToNs = (iso: string): string => (BigInt(new Date(iso).getTime()) * 1_000_000n).toString();

interface RawReceipt {
  id: number;
  owner_id: string;
  claimed: boolean;
  merchant_id: string;
  order_ref: string;
  amount: string;
  released: string;
  refunded: string;
  pending_refund: string;
  kind: Kind;
  status: ReceiptStatus;
  window_end: string;
  created_at: string;
  schedule: Array<{ at: string; amount: string; state: TrancheState }>;
  refund_target: RefundTarget;
  secret_nonce: number;
}

function normalize(r: RawReceipt): Receipt {
  return {
    id: String(r.id),
    merchantId: r.merchant_id,
    orderRef: r.order_ref,
    amount: r.amount,
    released: r.released,
    refunded: r.refunded,
    pendingRefund: r.pending_refund,
    kind: r.kind,
    windowEnd: nsToIso(r.window_end),
    schedule: r.schedule.map((t) => ({ at: nsToIso(t.at), amount: t.amount, state: t.state })),
    refundTarget: r.refund_target,
    owner: r.owner_id,
    claimed: r.claimed,
    secretNonce: r.secret_nonce,
    status: r.status,
    createdAt: nsToIso(r.created_at),
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

  /** Send one function call and wait for the whole receipt tree (callbacks included). */
  async call<T = unknown>(signer: string, contract: string, method: string, args: object, opts: { gas?: string; deposit?: string } = {}): Promise<TxResult<T>> {
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

  async getReceiptByOrderRef(merchantId: string, orderRef: string): Promise<Receipt | null> {
    const r = await this.view<RawReceipt | null>(this.receipts, "get_receipt_by_order_ref", { merchant_id: merchantId, order_ref: orderRef });
    return r ? normalize(r) : null;
  }

  async receiptsForMerchant(merchantId: string, fromIndex = 0, limit = 100): Promise<Receipt[]> {
    const rows = await this.view<RawReceipt[]>(this.receipts, "receipts_for_merchant", { merchant_id: merchantId, from_index: fromIndex, limit });
    return (rows ?? []).map(normalize);
  }

  async receiptsForOwner(accountId: string, fromIndex = 0, limit = 100): Promise<Receipt[]> {
    const rows = await this.view<RawReceipt[]>(this.receipts, "receipts_for_owner", { account_id: accountId, from_index: fromIndex, limit });
    return (rows ?? []).map(normalize);
  }

  async getMerchant(id: string): Promise<MerchantConfig | null> {
    const m = await this.view<{ payout: string; approver: string; guard_threshold: string; default_window_secs: number } | null>(this.receipts, "get_merchant", { id });
    return m ? { payout: m.payout, approver: m.approver, guardThreshold: m.guard_threshold, defaultWindowSecs: m.default_window_secs } : null;
  }

  async getConfig(): Promise<ContractConfig> {
    const c = await this.view<{ usdc: string; executor: string; allocated: string; in_flight: string; receipt_count: number }>(this.receipts, "get_config");
    return { usdc: c.usdc, executor: c.executor, allocated: c.allocated, inFlight: c.in_flight, receiptCount: c.receipt_count };
  }

  async usdcBalance(accountId: string): Promise<string> {
    return (await this.view<string>(this.usdc, "ft_balance_of", { account_id: accountId })) ?? "0";
  }

  /** USDC sitting in the receipt contract that no receipt has claimed yet. */
  async unassignedUsdc(): Promise<string> {
    const [bal, cfg] = await Promise.all([this.usdcBalance(this.receipts), this.getConfig()]);
    const free = BigInt(bal) - BigInt(cfg.allocated) - BigInt(cfg.inFlight);
    return (free > 0n ? free : 0n).toString();
  }

  async accountExists(accountId: string): Promise<boolean> {
    return this.near.accountExists(accountId);
  }

  // ---------- receipt contract calls ----------

  registerMerchant(merchantId: string, m: MerchantConfig) {
    return this.call(merchantId, this.receipts, "register_merchant", {
      payout: m.payout,
      approver: m.approver,
      guard_threshold: m.guardThreshold,
      default_window_secs: m.defaultWindowSecs,
    });
  }

  mintReceipt(executor: string, a: MintArgs) {
    return this.call<number>(
      executor,
      this.receipts,
      "mint_receipt",
      {
        args: {
          merchant_id: a.merchantId,
          order_ref: a.orderRef,
          amount: a.amount,
          kind: a.kind,
          window_secs: a.windowSecs ?? null,
          schedule: a.schedule.map((t) => ({ at: isoToNs(t.at), amount: t.amount })),
          refund_target: a.refundTarget,
          secret_hash: a.secretHash ?? null,
        },
      },
      { gas: GAS.mint },
    );
  }

  release(signer: string, id: string) {
    return this.call(signer, this.receipts, "release", { id: Number(id) }, { gas: GAS.transfer });
  }

  requestRefund(signer: string, id: string, amount: string, auth?: { secret: string; nextSecretHash: string }) {
    return this.call(signer, this.receipts, "request_refund", {
      id: Number(id),
      amount,
      secret: auth?.secret ?? null,
      next_secret_hash: auth?.nextSecretHash ?? null,
    });
  }

  cancel(signer: string, id: string, auth?: { secret: string; nextSecretHash: string }) {
    return this.call(signer, this.receipts, "cancel", { id: Number(id), secret: auth?.secret ?? null, next_secret_hash: auth?.nextSecretHash ?? null });
  }

  approveRefund(approver: string, id: string) {
    return this.call(approver, this.receipts, "approve_refund", { id: Number(id) });
  }

  rejectRefund(approver: string, id: string) {
    return this.call(approver, this.receipts, "reject_refund", { id: Number(id) });
  }

  executeRefund(executor: string, id: string, depositAccount: string, amount: string) {
    return this.call(executor, this.receipts, "execute_refund", { id: Number(id), deposit_account: depositAccount, amount }, { gas: GAS.transfer });
  }

  claim(signer: string, id: string, secret: string, account: string) {
    return this.call(signer, this.receipts, "claim", { id: Number(id), secret, account });
  }

  setRefundTarget(owner: string, id: string, target: RefundTarget) {
    return this.call(owner, this.receipts, "set_refund_target", { id: Number(id), target });
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
