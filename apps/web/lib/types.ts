/** Shapes returned by the API (see @uc/core `receiptView`, `merchantReceipts`). */
import type { Receipt } from "@uc/chain/types";

export type { Receipt };

export interface ChatMessage {
  role: "customer" | "agent" | "merchant" | "system";
  text: string;
  imageName?: string;
  at: string;
}

export interface CaseView {
  id: string;
  receiptId: string;
  kind: "refund" | "cancel" | "merchant";
  amount: string;
  messages: ChatMessage[];
  rounds: number;
  aiState: string;
  decision: { decision: "approve" | "partial" | "escalate" | "deny"; amount: string; category: string; summary: string; confidence: number; engine: string } | null;
  summaryHash: string | null;
  customerDeadline: string | null;
  payoutState: "none" | "sent" | "delivered" | "failed";
  depositAddress: string | null;
  quoteId: string | null;
  amountOutFormatted: string | null;
  txHash: string | null;
  error: string | null;
  closed: boolean;
  createdAt: string;
}

export interface PaidWith {
  symbol: string | null;
  chain: string | null;
  amountFormatted: string | null;
  direct: boolean;
}

export interface ReceiptView {
  receipt: Receipt;
  refundable: string;
  chainNow: string;
  contract: string;
  usdc: string;
  networkId: string;
  merchant: { id: string; name: string; aiTriage: boolean };
  product: string | null;
  orderRef: string | null;
  fulfilment: string;
  trackingUrl: string | null;
  paidWith: PaidWith | null;
  ownerIsDemoAccount: boolean;
  cases: CaseView[];
  events: Array<{ event: string; data: Record<string, unknown>; txHash: string | null; at: string }>;
  mode: string;
}

export interface DashReceipt extends Omit<Receipt, "orderRef"> {
  refundable: string;
  product: string | null;
  orderRef: string | null;
  fulfilment: string;
  trackingUrl: string | null;
  paidWith: PaidWith | null;
  case: CaseView | null;
}
