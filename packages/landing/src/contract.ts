/**
 * Verbatim excerpts of the receipt contract's refund guards
 * (contracts/receipts/src/refunds.rs). A test checks every line against the
 * source at the given line number, so the page can't drift from the code.
 */
export const CONTRACT_FILE = "contracts/receipts/src/refunds.rs";

export interface Excerpt {
  fn: string;
  rule: string;
  line: number;
  code: string[];
  /** Index of the line to highlight. */
  hl: number;
}

export const EXCERPTS: Excerpt[] = [
  {
    fn: "ai_decide",
    rule: "Above the guard threshold, an AI approval becomes an escalation. Otherwise it waits out the veto window.",
    line: 88,
    hl: 0,
    code: [
      "if amount.0 > m.auto_approve_max || amount.0 > m.guard_threshold {",
      "    q.state = RequestState::Escalated;",
      "    q.decision_deadline = deadline(now, m.response_secs);",
      "} else {",
      "    q.state = RequestState::AiApproved;",
      "    q.amount = amount.0;",
      "    q.veto_until = Some(deadline(now, m.veto_secs));",
      "}",
    ],
  },
  {
    fn: "veto",
    rule: "The business can overrule an AI approval only inside the veto window.",
    line: 126,
    hl: 1,
    code: ["require!(", "    q.veto_until.is_some_and(|until| now < until),", '    "veto window is over"', ");"],
  },
  {
    fn: "finalize_request",
    rule: "Silence means approval once the decision deadline passes.",
    line: 221,
    hl: 0,
    code: ['_ => require!(now >= q.decision_deadline, "decision deadline not reached"),'],
  },
  {
    fn: "execute_refund",
    rule: "No refund can push the day's total past the business's daily cap.",
    line: 307,
    hl: 1,
    code: ["require!(", "    m.refunded_today + amount <= m.daily_refund_cap,", '    "daily refund cap exceeded"', ");"],
  },
];
