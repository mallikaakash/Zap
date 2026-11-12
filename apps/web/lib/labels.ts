import type { Receipt } from "@uc/chain/types";
import type { Tone } from "@/components/ui";

const ACTIVE = ["Open", "AiApproved", "Escalated", "Approved"];

/** One plain-language status for a receipt, covering both the money and any open request. */
export function receiptStatus(r: Receipt): { label: string; tone: Tone } {
  const q = r.request;
  if (q && ACTIVE.includes(q.state)) {
    if (q.state === "Open") return { label: q.isCancel ? "Cancellation in review" : "Refund in review", tone: "warn" };
    if (q.state === "AiApproved") return { label: "Refund approved · shop may object", tone: "accent" };
    if (q.state === "Escalated") return { label: "Waiting for the shop", tone: "warn" };
    return { label: "Refund being sent", tone: "accent" };
  }
  switch (r.status) {
    case "Refunded":
      return { label: "Refunded", tone: "neutral" };
    case "PartiallyRefunded":
      return { label: "Partly refunded", tone: "neutral" };
    case "Released":
      return { label: "Paid to shop", tone: "good" };
    case "PartiallyReleased":
      return { label: "Partly paid to shop", tone: "good" };
    default:
      return { label: "Held in escrow", tone: "accent" };
  }
}

export const EVENT_LABELS: Record<string, string> = {
  receipt_minted: "Payment received; receipt created",
  released: "Paid out to the shop",
  refund_requested: "Refund requested",
  cancelled: "Cancellation requested",
  ai_decided: "Refund assistant decided",
  vetoed: "Shop asked to review",
  appealed: "Customer appealed",
  refund_approved: "Refund approved",
  refund_rejected: "Refund declined by the shop",
  request_finalized: "Refund approved automatically",
  refund_executed: "Refund left escrow",
  refund_delivered: "Refund delivered",
  confirmed: "Customer confirmed the order arrived",
  claimed: "Receipt claimed to a NEAR account",
  transferred: "Receipt transferred",
  refund_target_changed: "Refund address changed",
};
