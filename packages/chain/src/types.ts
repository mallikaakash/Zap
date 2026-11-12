export type Kind = "OneTime" | "Subscription" | "Schedule";
export type ReceiptStatus = "Held" | "PartiallyReleased" | "Released" | "PartiallyRefunded" | "Refunded";
export type TrancheState = "Pending" | "Released" | "RefundPending" | "Refunded";
export type RequestState = "Open" | "AiApproved" | "AiDenied" | "Escalated" | "Approved" | "Rejected" | "Executed";
export type AiDecision = "approve" | "partial" | "escalate" | "deny";

/** Request states that block release and block opening another request. */
export const ACTIVE_REQUEST_STATES: readonly RequestState[] = ["Open", "AiApproved", "Escalated", "Approved"];

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

export interface RefundRequest {
  amount: string;
  reasonHash: string;
  summaryHash: string | null;
  openedAt: string;
  /** Merchant must decide by then; silence = approval. */
  decisionDeadline: string;
  /** AI approvals only: the merchant may veto until then. */
  vetoUntil: string | null;
  appealed: boolean;
  isCancel: boolean;
  byMerchant: boolean;
  state: RequestState;
}

/** A receipt as the app sees it: ids are strings, money is minor-unit strings, times are ISO. */
export interface Receipt {
  id: string;
  merchantId: string;
  /** Hash of the merchant's order id — nothing readable goes on chain. */
  orderRef: string;
  amount: string;
  released: string;
  refunded: string;
  inFlight: string;
  kind: Kind;
  status: ReceiptStatus;
  windowEnd: string;
  createdAt: string;
  confirmed: boolean;
  schedule: Tranche[];
  refundTarget: RefundTarget;
  /** NFT owner. Equals the contract account while unclaimed. */
  owner: string;
  claimed: boolean;
  transferable: boolean;
  /** ed25519 public key (hex) while unclaimed. */
  receiptKey: string | null;
  nonce: number;
  request: RefundRequest | null;
}

export interface MerchantConfig {
  payout: string;
  approver: string;
  guardThreshold: string;
  defaultWindowSecs: number;
  responseSecs: number;
  dailyRefundCap: string;
  aiTriage: boolean;
  autoApproveMax: string;
  vetoSecs: number;
}

export interface MerchantState extends MerchantConfig {
  /** yoctoNEAR prepaid for receipt storage. */
  storageBalance: string;
  refundedToday: string;
  receiptCount: number;
}

export interface ContractConfig {
  usdc: string;
  executor: string;
  owner: string;
  allocated: string;
  inFlightTotal: string;
  mintLock: boolean;
  paused: boolean;
  receiptCount: number;
  /** yoctoNEAR charged to the merchant per receipt. */
  receiptStorageCost: string;
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
  refundTarget?: RefundTarget;
  receiptKey?: string;
  transferable?: boolean;
}
