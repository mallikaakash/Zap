/**
 * The "seller protections" demo: what happens to a $24 refund request under the
 * seller's settings. Mirrors the contract rules in contracts/INTERFACE.md:
 *  - ai_decide escalates instead of approving when amount > guard_threshold;
 *  - an AI approval waits out veto_secs before finalize_request;
 *  - execute_refund needs refunded_today + amount <= daily_refund_cap;
 *  - finalize_request approves on silence after decision_deadline.
 * Whole dollars here are display values only; the product itself uses USDC minor units.
 */

export const GUARD = [10, 20, 30, 50] as const;
export const VETO_H = [2, 6, 12, 24] as const;
export const CAP = [25, 50, 100, 250] as const;
export const DEADLINE_H = [24, 48, 72] as const;

export interface ProtectionIdx {
  thr: number;
  veto: number;
  cap: number;
  dl: number;
}
export const INITIAL_PROTECTIONS: ProtectionIdx = { thr: 1, veto: 1, cap: 1, dl: 1 };

export const REQUEST = 24;
export const REFUNDED_TODAY = 40;

export type Tone = "ok" | "attention" | "neutral" | "plain";
export interface Evaluation {
  title: string;
  body: string;
  tone: Tone;
}

export function evaluate(idx: ProtectionIdx) {
  const thr = GUARD[idx.thr]!;
  const veto = VETO_H[idx.veto]!;
  const cap = CAP[idx.cap]!;
  const dl = DEADLINE_H[idx.dl]!;
  const overThr = REQUEST > thr;
  const overCap = REFUNDED_TODAY + REQUEST > cap;
  const evals: Evaluation[] = [
    overThr
      ? { tone: "attention", title: "Escalated to you", body: `$${REQUEST} is above your $${thr} guard threshold, so the AI can only recommend.` }
      : { tone: "ok", title: "AI can approve", body: `$${REQUEST} is within your $${thr} guard threshold.` },
    overThr
      ? { tone: "neutral", title: "No veto needed", body: "You’re deciding directly." }
      : { tone: "ok", title: `${veto}h to veto`, body: "The approval waits out your veto window before anything moves." },
    overCap
      ? { tone: "attention", title: "Daily cap reached", body: `$${REFUNDED_TODAY} already refunded today. Another $${REQUEST} would pass your $${cap} cap, so it can’t execute today.` }
      : { tone: "ok", title: "Within your daily cap", body: `$${REFUNDED_TODAY + REQUEST} of $${cap} used today.` },
    { tone: "plain", title: `Deadline: ${dl}h`, body: "If nobody decides by then, the shopper’s request is approved." },
  ];
  const tag = overCap ? "HELD" : overThr ? "NEEDS YOU" : "AUTO-APPROVE";
  return { thr, veto, cap, dl, evals, tag, overThr, overCap };
}

/** Step one setting by ±1, clamped to its option list. */
export function nudge(idx: ProtectionIdx, key: keyof ProtectionIdx, d: number): ProtectionIdx {
  const len = { thr: GUARD.length, veto: VETO_H.length, cap: CAP.length, dl: DEADLINE_H.length }[key];
  return { ...idx, [key]: Math.max(0, Math.min(len - 1, idx[key] + d)) };
}

/**
 * Prepaid pass demo: 6 monthly periods of 8 USDC (as minor units, 6 dp).
 * Started periods release; cancelling returns every period that hasn't started.
 */
export const PASS_PERIODS = 6;
export const PASS_PRICE_MINOR = 8_000_000n;

export function passTotals(p: number, cancelled: boolean) {
  const started = Math.min(PASS_PERIODS, p + (p < PASS_PERIODS ? 1 : 0));
  const returnedN = cancelled ? PASS_PERIODS - started : 0;
  const releasedN = Math.min(p, PASS_PERIODS);
  const escrowN = PASS_PERIODS - releasedN - returnedN;
  const minor = (n: number) => BigInt(n) * PASS_PRICE_MINOR;
  return { released: minor(releasedN), escrow: minor(escrowN), returned: minor(returnedN), returnedN };
}

/** Format USDC minor units (6 dp) as "12.00". */
export function usdc2(minor: bigint): string {
  const cents = (minor + 5_000n) / 10_000n;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}
