import { describe, expect, it } from "vitest";
import { advance, flowView, INITIAL_FLOW, sequence, type FlowState } from "../src/flow";
import { evaluate, INITIAL_PROTECTIONS, nudge, passTotals, usdc2 } from "../src/protections";

describe("hero flow", () => {
  it("has 10 payment steps and 13 refund steps", () => {
    expect(sequence("pay", "ETH")).toHaveLength(10);
    expect(sequence("refund", "BTC")).toHaveLength(13);
    expect(sequence("refund", "BTC").at(-1)!.cap).toContain("BTC on Bitcoin");
  });

  it("alternates a payment loop and a refund loop", () => {
    let s: FlowState = INITIAL_FLOW;
    const modes = new Set<string>();
    let loops = 0;
    for (let i = 0; i < 200 && loops < 2; i++) {
      const n = advance(s);
      if (n.run !== s.run) loops++;
      modes.add(n.mode);
      s = n;
    }
    expect(loops).toBe(2);
    expect(modes).toEqual(new Set(["pay", "refund"]));
  });

  it("does not move while paused", () => {
    const s = { ...INITIAL_FLOW, step: 3, paused: true };
    expect(advance(s)).toBe(s);
  });

  it("picks the phone screen for each step", () => {
    const screens = Array.from({ length: 10 }, (_, step) => flowView({ ...INITIAL_FLOW, step }).screen);
    expect(screens).toEqual(["shop", "sheet", "progress", "progress", "progress", "progress", "receipt", "receipt", "final", "final"]);
  });
});

describe("seller protections", () => {
  it("auto-approves within threshold and cap", () => {
    const r = evaluate({ thr: 3, veto: 0, cap: 3, dl: 0 });
    expect(r.tag).toBe("AUTO-APPROVE");
  });
  it("escalates above the guard threshold, like ai_decide", () => {
    expect(evaluate({ ...INITIAL_PROTECTIONS, cap: 3 }).tag).toBe("NEEDS YOU"); // $24 > $20
    expect(evaluate(INITIAL_PROTECTIONS).tag).toBe("HELD"); // default: cap also hit
  });
  it("holds when the daily cap would be exceeded", () => {
    expect(evaluate({ thr: 3, veto: 0, cap: 1, dl: 0 }).tag).toBe("HELD"); // 40 + 24 > 50
  });
  it("clamps nudges", () => {
    expect(nudge({ thr: 0, veto: 0, cap: 0, dl: 0 }, "thr", -1).thr).toBe(0);
    expect(nudge({ thr: 3, veto: 0, cap: 0, dl: 0 }, "thr", 1).thr).toBe(3);
  });
});

describe("pass totals", () => {
  it("adds up to the full pass at every point", () => {
    for (let p = 0; p <= 6; p++)
      for (const c of [false, true]) {
        const t = passTotals(p, c);
        expect(t.released + t.escrow + t.returned).toBe(48_000_000n);
      }
  });
  it("returns unstarted months on cancel", () => {
    expect(usdc2(passTotals(2, true).returned)).toBe("24.00");
    expect(usdc2(passTotals(2, false).escrow)).toBe("32.00");
  });
});
