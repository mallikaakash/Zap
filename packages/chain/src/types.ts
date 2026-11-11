export type Kind = "OneTime" | "Subscription" | "Schedule";
export type ReceiptStatus = "Held" | "PartiallyReleased" | "Released" | "RefundRequested" | "PendingApproval" | "Refunded";
export type TrancheState = "Pending" | "Released" | "RefundPending" | "Refunded";

export interface RefundTarget {
  chain: string;
  asset: string;
  address: string;
}

export interface Tranche {
  /** ISO timestamp. */
  at: string;
  /** Minor units. */
  amount: string;
  state: TrancheState;
}

/** A receipt as the app sees it: ids are strings, money is minor-unit strings, times are ISO. */
export interface Receipt {
  id: string;
  merchantId: string;
  orderRef: string;
  amount: string;
  released: string;
  refunded: string;
  pendingRefund: string;
  kind: Kind;
  windowEnd: string;
  schedule: Tranche[];
  refundTarget: RefundTarget;
  /** NFT owner. Equals the contract account while unclaimed. */
  owner: string;
  claimed: boolean;
  secretNonce: number;
  status: ReceiptStatus;
  createdAt: string;
}

export interface MerchantConfig {
  payout: string;
  approver: string;
  guardThreshold: string;
  defaultWindowSecs: number;
}

export interface ContractConfig {
  usdc: string;
  executor: string;
  allocated: string;
  inFlight: string;
  receiptCount: number;
}

export interface ChainEventLog {
  event: string;
  data: Record<string, unknown>;
}

export interface TxResult<T = unknown> {
  txHash: string;
  value: T;
  events: ChainEventLog[];
  logs: string[];
}

export interface MintArgs {
  merchantId: string;
  orderRef: string;
  amount: string;
  kind: Kind;
  windowSecs?: number;
  /** `at` as ISO timestamps. */
  schedule: Array<{ at: string; amount: string }>;
  refundTarget: RefundTarget;
  secretHash?: string;
}
