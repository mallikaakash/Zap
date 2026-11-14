import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONTRACT_FILE, EXCERPTS } from "../src/contract";
import { advance, dwell, flowView, INITIAL_FLOW, LEGEND, scrubTo, scrubToPhase, sequence, storyPhase, type FlowState } from "../src/flow";
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

  it("holds longest on the open refund window", () => {
    const ms = sequence("pay", "ETH").map((st) => st.ms);
    expect(Math.max(...ms)).toBe(ms[7]);
    expect(dwell({ ...INITIAL_FLOW, step: 7 })).toBe(ms[7]);
  });

  it("scrubs to high-level story phases", () => {
    expect(scrubToPhase(INITIAL_FLOW, "pay")).toMatchObject({ step: 1, paused: true });
    expect(scrubToPhase(INITIAL_FLOW, "escrow").step).toBe(7);
    expect(scrubToPhase(INITIAL_FLOW, "payout").step).toBe(9);
    expect(storyPhase({ ...INITIAL_FLOW, step: 9 })).toBe("3 · Payout");
  });

  it("scrubs to the step where each actor works, and pauses", () => {
    expect(scrubTo(INITIAL_FLOW, "bridge")).toMatchObject({ step: 3, mode: "pay", paused: true });
    expect(scrubTo(INITIAL_FLOW, "vault").step).toBe(6);
    expect(scrubTo(INITIAL_FLOW, "asst")).toMatchObject({ step: 8, mode: "refund" });
    for (const [, actor] of LEGEND) {
      const s = scrubTo(INITIAL_FLOW, actor);
      expect(flowView(s).active(actor)).toBe(true);
    }
  });

  it("lets the chosen coin drive the captions", () => {
    const caps = sequence("pay", "SOL").map((st) => st.cap).join(" ");
    expect(caps).toContain("SOL on Solana");
    expect(flowView({ ...INITIAL_FLOW, coin: "BTC", step: 2 }).puck.text).toBe("BTC");
  });

  it("rises to the right: the shop sits above the bridge", () => {
    const view = flowView({ ...INITIAL_FLOW, step: 8 });
    const bridge = view.pins.find((p) => p.n === "03")!;
    const shop = view.pins.find((p) => p.n === "06")!;
    expect(shop.x).toBeGreaterThan(bridge.x);
    expect(shop.y).toBeLessThan(bridge.y);
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

describe("contract excerpt", () => {
  it("matches contracts/receipts/src/refunds.rs line for line", () => {
    const src = readFileSync(fileURLToPath(new URL(`../../../${CONTRACT_FILE}`, import.meta.url)), "utf8").split("\n");
    for (const ex of EXCERPTS) {
      ex.code.forEach((line, i) => {
        expect(src[ex.line - 1 + i]?.trim(), `${ex.fn} line ${ex.line + i}`).toBe(line.trim());
      });
      // indentation inside the excerpt is preserved relative to its first line
      const base = src[ex.line - 1]!.search(/\S/);
      ex.code.forEach((line, i) => expect(src[ex.line - 1 + i]!.slice(base)).toBe(line));
    }
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
