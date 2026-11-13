"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useApp, v } from "./context";
import { advance, COIN_KEYS, COINS, flowView, INITIAL_FLOW, LEGEND, USDC_COLOR, type FlowState } from "./flow";
import { Arrow, Bolt, Check, Mark } from "./icons";

const ACCENT = "#FF2D87";
const TICK_MS = 2000;

export function Header() {
  const { href, mode } = useApp();
  return (
    <header className="z-wrap z-header">
      <a href="#top" className="z-brand">
        <Mark />
        <span className="z-display" style={{ fontSize: 22, letterSpacing: "-0.02em" }}>
          Zap
        </span>
        <span className="z-mono" style={{ fontSize: 11, fontWeight: 600, color: "var(--z-muted)", border: "1px solid #DCDCDC", borderRadius: 6, padding: "3px 6px" }}>
          PAYMENTS
        </span>
        {mode && mode !== "live" ? (
          <span className="z-sim" title="No real money moves in this mode. Swaps are simulated; the escrow contract is real.">
            SIMULATED · {mode === "local" ? "LOCAL SANDBOX" : "TESTNET"}
          </span>
        ) : null}
      </a>
      <nav aria-label="Primary" className="z-nav">
        <a className="z-navlink" href="#how">
          How it works
        </a>
        <a className="z-navlink" href="#refunds">
          Refunds
        </a>
        <a className="z-navlink" href="#verify">
          Verify a receipt
        </a>
        <a className="z-navlink" href="#docs">
          Docs
        </a>
        <a className="z-btn ink sm" href={href("/dashboard")}>
          Get the button
        </a>
      </nav>
    </header>
  );
}

export function Hero() {
  return (
    <section id="top" className="z-wrap" style={{ paddingTop: 48, paddingBottom: 8, display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 40 }}>
      <div className="z-col" style={{ flex: "1 1 520px", gap: 20, minWidth: 0 }}>
        <span className="z-mono" style={{ fontSize: 13, fontWeight: 500, color: "var(--z-muted)", letterSpacing: "0.04em" }}>
          UNIVERSAL CHECKOUT · BUILT ON NEAR INTENTS
        </span>
        <h1 className="z-h1">
          Any coin in.
          <br />
          <span className="z-acc">USDC</span> out.
        </h1>
      </div>
      <div className="z-col" style={{ flex: "1 1 340px", maxWidth: 440, gap: 22, paddingBottom: 8 }}>
        <p style={{ fontSize: 18, lineHeight: 1.6, color: "var(--z-body)" }}>
          One button on any checkout. Shoppers pay with what they hold, on any chain. You receive USDC, and every payment becomes a receipt NFT that keeps the money in escrow until the refund window closes.
        </p>
        <div className="z-row" style={{ gap: 12 }}>
          <a href="#start" className="z-btn ink">
            Add it to your site <Arrow />
          </a>
          <a href="#verify" className="z-btn">
            Verify a receipt
          </a>
        </div>
      </div>
    </section>
  );
}

/** Scale the fixed 940×600 scene to the width it is given. */
function useFitScale(ref: React.RefObject<HTMLDivElement | null>, width: number) {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(Math.min(1, (e?.contentRect.width ?? width) / width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, width]);
  return scale;
}

export function FlowDemo() {
  const [s, setS] = useState<FlowState>(INITIAL_FLOW);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    if (mq.matches) setS((x) => ({ ...x, paused: true }));
  }, []);
  useEffect(() => {
    const t = setInterval(() => setS((x) => advance(x)), TICK_MS);
    return () => clearInterval(t);
  }, []);
  const go = (patch: Partial<FlowState>) => setS((x) => ({ ...x, hold: 0, ...patch }));
  const f = flowView(s);
  const boxRef = useRef<HTMLDivElement>(null);
  const scale = useFitScale(boxRef, 940);

  return (
    <section id="how" aria-label="Interactive payment demo" style={{ maxWidth: 1440, margin: "0 auto", paddingTop: 24 }} className="z-wrap">
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <Phone s={s} f={f} go={go} />
        <div ref={boxRef} className="z-stagebox">
          <div style={{ height: 600 * scale, overflow: "hidden" }} aria-hidden="true">
            <Scene s={s} f={f} scale={scale} />
          </div>
        </div>
      </div>

      <div className="z-row" style={{ gap: "16px 24px", marginTop: 12, padding: "18px 20px 18px 24px", border: "1.5px solid var(--z-ink)", borderRadius: 20 }}>
        <span className="z-mono" style={{ fontSize: 13, fontWeight: 700, background: "var(--z-accent)", padding: "6px 10px", borderRadius: 8 }}>
          {f.stepNo}
        </span>
        <p aria-live="polite" className="z-display" style={{ flex: "1 1 320px", fontSize: 21, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.3 }}>
          {f.cur.cap}
        </p>
        <div className="z-row" style={{ gap: 8 }}>
          <button type="button" className="z-btn sm" aria-pressed={!f.refundStory} onClick={() => go({ step: 0, mode: "pay", run: 0, paused: false })}>
            Payment
          </button>
          <button type="button" className="z-btn sm" aria-pressed={f.refundStory} onClick={() => go({ step: 0, mode: "pay", run: 1, paused: false })}>
            Refund
          </button>
          <button type="button" className="z-btn sm icon" aria-label={s.paused ? "Play animation" : "Pause animation"} onClick={() => setS((x) => ({ ...x, paused: !x.paused }))}>
            {s.paused ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M7 4v16l13-8z" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            )}
          </button>
        </div>
      </div>
      {reduced ? (
        <p style={{ marginTop: 8, fontSize: 13, color: "var(--z-muted)" }}>Animation paused because your system asks for reduced motion. Press play to step through it.</p>
      ) : null}

      <ol style={{ marginTop: 24, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(170px, 100%), 1fr))", gap: 12 }}>
        {LEGEND.map(([n, id, title, body]) => {
          const on = f.active(id);
          return (
            <li key={n} className="z-col" style={{ gap: 8, padding: 16, borderRadius: 16, border: `1.5px solid ${on ? "#111111" : "#E4E4E0"}`, background: on ? "var(--z-tint)" : "#FFFFFF", transition: "border-color .3s ease, background-color .3s ease" }}>
              <span className="z-mono" style={{ alignSelf: "flex-start", fontWeight: 700, fontSize: 12, padding: "4px 8px", borderRadius: 7, background: on ? ACCENT : "#F1F1EE" }}>
                {n}
              </span>
              <span style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.3 }}>{title}</span>
              <span style={{ fontSize: 13, lineHeight: 1.5, color: "var(--z-body2)" }}>{body}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

type View = ReturnType<typeof flowView>;
type Go = (patch: Partial<FlowState>) => void;

function Phone({ s, f, go }: { s: FlowState; f: View; go: Go }) {
  return (
    <div className="z-phw">
      <div className="z-ph">
        <div className="z-ph-back" />
        <div className="z-ph-mid" />
        <div className="z-ph-side">
          <span style={{ position: "absolute", left: 4, top: 70, width: 7, height: 34, borderRadius: 2, background: "#6A6A6A" }} />
          <span style={{ position: "absolute", left: 4, top: 116, width: 7, height: 54, borderRadius: 2, background: "#6A6A6A" }} />
        </div>
        <div className="z-ph-body">
          <div className="z-ph-screen">
            <div style={{ height: 34, display: "flex", justifyContent: "center", alignItems: "flex-end", flex: "none" }}>
              <span style={{ width: 92, height: 24, background: "#0E0E0E", borderRadius: 999 }} />
            </div>
            <PhoneScreen key={f.screen} s={s} f={f} go={go} />
            <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "linear-gradient(118deg, rgba(255,255,255,0) 52%, rgba(255,255,255,.22) 58%, rgba(255,255,255,0) 66%)" }} />
          </div>
        </div>
      </div>
      <div className="z-ph-shadow" aria-hidden="true" />
    </div>
  );
}

function PhoneScreen({ s, f, go }: { s: FlowState; f: View; go: Go }) {
  const coin = f.coin;
  if (f.screen === "shop")
    return (
      <div className="z-scr">
        <div style={{ height: 34, borderRadius: 10, background: "#F3F3F1", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--z-muted)" }}>kettleandco.shop</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span className="z-display" style={{ fontSize: 19 }}>
            Kettle &amp; Co.
          </span>
          <span style={{ fontSize: 13, color: "var(--z-muted)" }}>Cart · 1</span>
        </div>
        <div aria-hidden="true" style={{ height: 170, borderRadius: 20, background: "#F3F3F1", position: "relative", overflow: "hidden", flex: "none" }}>
          <div style={{ position: "absolute", left: "50%", bottom: 26, width: 96, height: 70, transform: "translateX(-50%)", borderRadius: "0 0 48px 48px", background: "#FFFFFF", border: "1.5px solid #111111" }} />
          <div style={{ position: "absolute", left: "50%", bottom: 92, width: 118, height: 14, transform: "translateX(-50%)", borderRadius: 8, background: "#111111" }} />
          <div style={{ position: "absolute", left: "50%", bottom: 104, width: 70, height: 36, transform: "translateX(-50%)", borderRadius: "40px 40px 6px 6px", background: ACCENT, border: "1.5px solid #111111" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div className="z-col" style={{ gap: 3 }}>
            <span style={{ fontWeight: 600, fontSize: 16 }}>Pour-over kit</span>
            <span style={{ fontSize: 13, color: "var(--z-muted)" }}>Ceramic dripper + 40 filters</span>
          </div>
          <span className="z-display" style={{ fontSize: 20 }}>
            $24.00
          </span>
        </div>
        <button type="button" className="z-pulse" onClick={() => go({ step: 1, mode: "pay" })} style={{ marginTop: "auto", minHeight: 56, border: 0, borderRadius: 16, background: "#111111", color: "#FFFFFF", fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <Bolt /> Pay with Zap
        </button>
        <span style={{ textAlign: "center", fontSize: 12, color: "var(--z-muted)", marginTop: -6 }}>Any coin, any chain · seller gets USDC</span>
      </div>
    );

  if (f.screen === "sheet")
    return (
      <div className="z-scr" style={{ paddingTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span className="z-display" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 18 }}>
            <Mark size={26} radius={8} /> Zap checkout
          </span>
          <span className="z-display" style={{ fontSize: 18 }}>
            $24.00
          </span>
        </div>
        <span style={{ fontSize: 13, color: "var(--z-muted)", marginTop: -6 }}>Kettle &amp; Co. · Pour-over kit</span>
        <div className="z-col" style={{ gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Pay with</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
            {COIN_KEYS.map((k) => {
              const on = s.coin === k;
              return (
                <button key={k} type="button" aria-pressed={on} onClick={() => go({ coin: k, step: 1, mode: "pay" })} style={{ minHeight: 52, borderRadius: 14, border: `1.5px solid ${on ? "#111111" : "#E2E2DD"}`, background: on ? "var(--z-tint)" : "#FFFFFF", display: "flex", alignItems: "center", gap: 10, padding: "0 12px", textAlign: "left" }}>
                  <span className="z-coin" style={{ background: COINS[k].color }} />
                  <span className="z-col" style={{ gap: 1 }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{COINS[k].label}</span>
                    <span style={{ fontSize: 11, color: "var(--z-muted)" }}>{COINS[k].chain}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <span style={{ fontSize: 12, color: "var(--z-muted)" }}>About 230 assets through NEAR Intents</span>
        </div>
        <div className="z-col" style={{ gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Refund address</span>
          <span className="z-mono" style={{ minHeight: 44, borderRadius: 12, border: "1.5px solid #D6D6D1", padding: "0 12px", fontSize: 13, background: "#F7F7F5", display: "flex", alignItems: "center" }}>
            {coin.addr}
          </span>
        </div>
        <button type="button" onClick={() => go({ step: 2, mode: "pay", run: 0 })} style={{ marginTop: "auto", minHeight: 54, border: 0, borderRadius: 16, background: ACCENT, color: "#111111", fontWeight: 700, fontSize: 16 }}>
          Pay in {coin.label}
        </button>
      </div>
    );

  if (f.screen === "progress") {
    const { rows, at } = f.progress;
    return (
      <div className="z-scr" style={{ paddingTop: 22, gap: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="z-mono" style={{ width: 48, height: 48, borderRadius: 999, background: f.refundProg ? USDC_COLOR : coin.color, border: "1.5px solid #111111", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12, flex: "none", color: f.refundProg ? "#FFFFFF" : "#111111" }}>
            {f.refundProg ? "USDC" : coin.label}
          </span>
          <div className="z-col" style={{ gap: 3 }}>
            <span className="z-display" style={{ fontSize: 20 }}>
              {f.refundProg ? "Refunding" : `Paying in ${coin.label}`}
            </span>
            <span style={{ fontSize: 13, color: "var(--z-muted)" }}>{f.refundProg ? `Back to your ${coin.chain} address` : `On ${coin.chain}`}</span>
          </div>
        </div>
        <ol className="z-col" style={{ gap: 6 }}>
          {rows.map(([label, sub], i) => {
            const done = i < at;
            const now = i === at;
            return (
              <li key={label} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 12px", borderRadius: 14, background: now ? "var(--z-tint)" : "transparent" }}>
                <span style={{ width: 24, height: 24, borderRadius: 999, border: `2px solid ${done ? "#111111" : now ? ACCENT : "#D6D6D1"}`, background: done ? "#111111" : "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  {done ? <Check size={12} width={3.4} /> : null}
                </span>
                <span className="z-col" style={{ gap: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: done || now ? "#111111" : "#767676" }}>{label}</span>
                  <span style={{ fontSize: 12, color: "#6B6B6B" }}>{sub}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  if (f.screen === "receipt")
    return (
      <div className="z-scr" style={{ paddingTop: 20 }}>
        <span className="z-display" style={{ fontSize: 21, letterSpacing: "-0.01em" }}>
          Paid. Here&apos;s your receipt.
        </span>
        <ReceiptCard f={f} big />
        <button type="button" onClick={() => go({ mode: "refund", step: 8 })} style={{ marginTop: "auto", minHeight: 52, borderRadius: 16, border: "1.5px solid #111111", background: "#FFFFFF", fontWeight: 600, fontSize: 15 }}>
          Request refund
        </button>
      </div>
    );

  return (
    <div className="z-scr" style={{ padding: "28px 22px", alignItems: "center", textAlign: "center", justifyContent: "center" }}>
      <span style={{ width: 76, height: 76, borderRadius: 999, background: f.isRefund ? coin.color : ACCENT, border: "1.5px solid #111111", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Check size={34} color="#111111" width={2.6} />
      </span>
      <span className="z-display" style={{ fontSize: 23, letterSpacing: "-0.02em" }}>
        {f.isRefund ? `Refunded in ${coin.label}` : "Order confirmed"}
      </span>
      <span style={{ fontSize: 14, lineHeight: 1.55, color: "var(--z-muted)" }}>{f.isRefund ? `Back on ${coin.chain}, to the refund address you gave at checkout.` : "Kettle & Co. is paid in USDC once the refund window ends."}</span>
      <button type="button" onClick={() => go({ step: 0, mode: "pay" })} style={{ marginTop: 10, minHeight: 46, padding: "0 22px", borderRadius: 999, border: 0, background: "#111111", color: "#FFFFFF", fontWeight: 600, fontSize: 14 }}>
        Back to the shop
      </button>
    </div>
  );
}

function ReceiptCard({ f, big }: { f: View; big?: boolean }) {
  return (
    <div className="z-col" style={{ borderRadius: big ? 22 : 16, background: "#111111", color: "#FFFFFF", padding: big ? 18 : "12px 14px", gap: big ? 14 : 6, boxShadow: big ? undefined : "0 14px 30px -12px rgba(0,0,0,.4)" }}>
      <div className="z-mono" style={{ display: "flex", justifyContent: "space-between", fontSize: big ? 11 : 10, fontWeight: 700, letterSpacing: "0.06em" }}>
        <span className="z-acc">RECEIPT NFT</span>
        <span style={{ color: "#BDBDBD", fontWeight: 400 }}>NEP-171</span>
      </div>
      <span className="z-display" style={{ fontSize: big ? 34 : 22, letterSpacing: "-0.03em" }}>
        24.00 USDC
      </span>
      {big ? (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#D4D4D4" }}>
          <span>Held in escrow</span>
          <span>Paid in {f.coin.label}</span>
        </div>
      ) : null}
      <div style={{ height: big ? 6 : 5, borderRadius: 999, background: "#333333", overflow: "hidden" }}>
        <div style={{ height: "100%", width: f.windowPct, background: ACCENT, transition: "width 1s linear" }} />
      </div>
      <span style={{ fontSize: big ? 12 : 11, color: "#D4D4D4" }}>{big ? "Refund window open" : f.nftState}</span>
    </div>
  );
}

const box = (w: number, h: number, d: number, c1: string, c2: string, c3: string, extra: Record<string, string> = {}) => v({ "--w": `${w}px`, "--h": `${h}px`, "--d": `${d}px`, "--c1": c1, "--c2": c2, "--c3": c3, ...extra });

function Bx({ style, children, front, top, right }: { style: React.CSSProperties; children?: React.ReactNode; front?: React.ReactNode; top?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="z-bx" style={style}>
      <div className="f tp">{top}</div>
      <div className="f fr">{front ?? children}</div>
      <div className="f rt">{right}</div>
    </div>
  );
}

function Scene({ s, f, scale }: { s: FlowState; f: View; scale: number }) {
  const coin = f.coin;
  const dashed = (inset: number, c = "#6A6A6A") => <div style={{ position: "absolute", inset, border: `1px dashed ${c}`, borderRadius: 4 }} />;
  const pillar = (x: number) => <Bx style={box(18, 58, 60, "#E6E6E2", "#D4D4CF", "#BDBDB7", { "--x": `${x}px` })} />;
  const tower = (x: number) => <Bx style={box(22, 150, 66, "#3A3A3A", "#1A1A1A", "#0E0E0E", { "--x": `${x}px` })} />;
  return (
    <div className="z-stage" style={{ transform: `scale(${scale})`, margin: "0 auto" }}>
      <div className="z-w3">
        {/* wallet */}
        <div className="z-o" style={{ transform: `translate3d(-520px, ${f.lf.wallet}px, 0px)` }}>
          <div className="z-gs" style={v({ "--sw": "190px", "--sh": "140px" })} />
          <Bx
            style={box(118, 48, 86, "#2C2C2C", "#1E1E1E", "#141414")}
            top={dashed(7)}
            right={dashed(6, "#5A5A5A")}
            front={
              <>
                {dashed(6)}
                <div style={{ position: "absolute", right: 14, top: -2, width: 38, height: 30, background: coin.color, border: "1.5px solid #111111", borderRadius: "0 0 10px 10px" }}>
                  <span style={{ position: "absolute", left: "50%", bottom: 6, width: 8, height: 8, marginLeft: -4, borderRadius: "50%", background: "#111111" }} />
                </div>
              </>
            }
          />
          {f.walletDiscs.map((d, i) => (
            <div key={i} className="z-dk" style={v({ "--s": "62px", "--x": "-6px", "--z": "-4px", "--y": `${d.y}px`, "--c": d.c })}>
              {d.t}
            </div>
          ))}
        </div>

        {/* bridge: NEAR Intents */}
        <div className="z-o" style={{ transform: `translate3d(-262px, ${f.lf.bridge}px, 0px)` }}>
          <div className="z-gs" style={v({ "--sw": "360px", "--sh": "120px" })} />
          {pillar(-148)}
          {pillar(148)}
          {tower(-104)}
          {tower(104)}
          <Bx style={box(318, 14, 58, "#5A76FF", "#3D5AFE", "#2A42D6", { "--y": "-58px" })} top={<div style={{ position: "absolute", left: 10, right: 10, top: "50%", height: 2, marginTop: -1, background: "repeating-linear-gradient(90deg,#FFFFFF 0 16px,transparent 16px 28px)" }} />} />
          <div className="z-cab" style={{ left: -104, top: -148, width: 208, height: 72, transform: "translateZ(32px)" }} />
          <div className="z-cab" style={{ left: -104, top: -148, width: 208, height: 72, transform: "translateZ(-32px)" }} />
          <div style={{ position: "absolute", left: -159, top: -148, width: 56, height: 76, transform: "translateZ(32px)", background: "linear-gradient(to top right, transparent calc(50% - 1px), #111111 calc(50% - 1px), #111111 calc(50% + 1px), transparent calc(50% + 1px))" }} />
          <div style={{ position: "absolute", left: 103, top: -148, width: 56, height: 76, transform: "translateZ(32px)", background: "linear-gradient(to top left, transparent calc(50% - 1px), #111111 calc(50% - 1px), #111111 calc(50% + 1px), transparent calc(50% + 1px))" }} />
        </div>

        {/* settlement worker */}
        <div className="z-o" style={{ transform: `translate3d(-30px, ${f.lf.worker}px, 200px)` }}>
          <div className="z-gs" style={v({ "--sw": "120px", "--sh": "120px" })} />
          <Bx
            style={box(66, 108, 66, "#FFFFFF", "#F2F2EF", "#DCDCD6")}
            top={<div style={{ position: "absolute", inset: 10, background: "repeating-linear-gradient(90deg,#111111 0 1.5px,transparent 1.5px 7px)" }} />}
            front={
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", gap: 6, padding: "9px 7px" }}>
                {[0, 1, 2, 3].map((i) => {
                  const on = f.active("worker") && i === 1;
                  return (
                    <div key={i} style={{ height: 15, border: "1.5px solid #111111", borderRadius: 3, background: "#FFFFFF", position: "relative", flex: "none" }}>
                      <span className={on ? "z-blink" : undefined} style={{ position: "absolute", right: 4, top: 3, width: 6, height: 6, borderRadius: "50%", background: on ? ACCENT : i === 3 ? "#2EBD6B" : "#BDBDB7" }} />
                    </div>
                  );
                })}
              </div>
            }
          />
        </div>

        {/* receipt contract vault */}
        <div className="z-o" style={{ transform: `translate3d(120px, ${f.lf.vault}px, 0px)` }}>
          <div className="z-gs" style={v({ "--sw": "200px", "--sh": "180px" })} />
          <Bx
            style={box(126, 126, 106, `color-mix(in srgb, ${ACCENT} 45%, #FFFFFF)`, ACCENT, `color-mix(in srgb, ${ACCENT} 72%, #111111)`)}
            front={
              <>
                <div style={{ position: "absolute", inset: 11, border: "1.5px solid #111111", borderRadius: 6, background: `color-mix(in srgb, ${ACCENT} 88%, #111111)` }} />
                <span style={{ position: "absolute", left: 4, top: 26, width: 6, height: 16, background: "#111111", borderRadius: 2 }} />
                <span style={{ position: "absolute", left: 4, bottom: 26, width: 6, height: 16, background: "#111111", borderRadius: 2 }} />
                <div style={{ position: "absolute", left: "50%", top: "50%", width: 54, height: 54, margin: "-27px 0 0 -35px", borderRadius: "50%", border: "1.5px solid #111111", background: "#FFFFFF" }}>
                  <div style={{ position: "absolute", inset: 4, borderRadius: "50%", background: "repeating-conic-gradient(#111111 0 2deg, transparent 2deg 30deg)", WebkitMask: "radial-gradient(circle, transparent 60%, #000 61%)", mask: "radial-gradient(circle, transparent 60%, #000 61%)" }} />
                  <div className={f.cur.win ? "z-spin" : undefined} style={{ position: "absolute", left: "50%", top: "50%", width: 2, height: 17, marginLeft: -1, background: "#111111", transformOrigin: "50% 0", transform: "rotate(180deg)" }} />
                  <span style={{ position: "absolute", left: "50%", top: "50%", width: 8, height: 8, margin: "-4px 0 0 -4px", borderRadius: "50%", background: "#111111" }} />
                </div>
                <span style={{ position: "absolute", right: 20, top: "50%", width: 8, height: 34, marginTop: -17, background: "#111111", borderRadius: 4 }} />
              </>
            }
          />
        </div>

        {/* refund assistant */}
        <div className="z-o" style={{ transform: `translate3d(130px, ${f.lf.asst}px, 210px)` }}>
          <div className="z-gs" style={v({ "--sw": "140px", "--sh": "100px" })} />
          <Bx style={box(72, 8, 48, "#FFFFFF", "#EDEDEA", "#D8D8D2")} />
          <Bx style={box(12, 30, 10, "#D8D8D2", "#C9C9C3", "#B5B5AE", { "--y": "-8px", "--z": "-6px" })} />
          <Bx
            style={box(118, 78, 10, "#3A3A3A", "#141414", "#2A2A2A", { "--y": "-34px", "--z": "-6px" })}
            front={
              <div style={{ position: "absolute", inset: 0, padding: 9, display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ alignSelf: "flex-start", width: 62, height: 13, borderRadius: "7px 7px 7px 2px", background: "#FFFFFF" }} />
                <span style={{ alignSelf: "flex-end", width: 52, height: 13, borderRadius: "7px 7px 2px 7px", background: f.active("asst") ? ACCENT : "#5A5A5A" }} />
                <span style={{ alignSelf: "flex-start", display: "flex", gap: 4, alignItems: "center" }}>
                  <span style={{ width: 13, height: 13, borderRadius: "50%", background: "#2EBD6B" }} />
                  <span style={{ width: 40, height: 6, borderRadius: 3, background: "#6A6A6A" }} />
                </span>
              </div>
            }
          />
        </div>

        {/* seller shop */}
        <div className="z-o" style={{ transform: `translate3d(470px, ${f.lf.shop}px, 0px)` }}>
          <div className="z-gs" style={v({ "--sw": "230px", "--sh": "190px" })} />
          <Bx
            style={box(150, 92, 112, "#FFFFFF", "#FAFAF8", "#E6E6E1")}
            front={
              <>
                <div style={{ position: "absolute", left: 18, bottom: -1.5, width: 36, height: 56, border: "1.5px solid #111111", borderBottom: 0, background: "#F0F0EC" }}>
                  <span style={{ position: "absolute", right: 5, top: 26, width: 5, height: 5, borderRadius: "50%", background: "#111111" }} />
                </div>
                <div style={{ position: "absolute", right: 16, top: 34, width: 68, height: 38, border: "1.5px solid #111111", backgroundColor: "#E3EAFF", backgroundImage: "linear-gradient(#111111,#111111), linear-gradient(#111111,#111111)", backgroundSize: "1.5px 100%, 100% 1.5px", backgroundPosition: "center, center", backgroundRepeat: "no-repeat" }} />
                <div style={{ position: "absolute", left: -4, right: -4, top: -1.5, height: 30, border: "1.5px solid #111111", background: `repeating-linear-gradient(90deg,${ACCENT} 0 16px,#FFFFFF 16px 32px)`, transformOrigin: "50% 0", transform: "rotateX(52deg)" }} />
              </>
            }
            right={<div style={{ position: "absolute", left: 30, top: 30, width: 50, height: 36, border: "1.5px solid #111111", background: "#D3DCF5" }} />}
          />
          <Bx style={box(162, 10, 122, "#2A2A2A", "#141414", "#0E0E0E", { "--y": "-92px" })} />
          <Bx
            style={box(118, 28, 6, "#111111", "#FFFFFF", "#E6E6E1", { "--y": "-102px", "--z": "20px" })}
            front={
              <div className="z-display" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, letterSpacing: "0.02em" }}>
                KETTLE &amp; CO.
              </div>
            }
          />
        </div>

        {/* USDC stack at the shop */}
        <div className="z-o" style={{ transform: `translate3d(330px, ${f.lf.shop}px, 130px)` }}>
          <div className="z-gs" style={v({ "--sw": "110px", "--sh": "110px" })} />
          {f.usdcDiscs.map((d, i) => (
            <div key={i} className="z-dk" style={{ ...v({ "--s": "58px", "--y": `${d.y}px`, "--c": d.c }), color: "#FFFFFF" }}>
              {d.t}
            </div>
          ))}
        </div>
      </div>

      <svg viewBox="-470 -336 940 600" style={{ position: "absolute", left: "50%", top: "56%", width: 940, height: 600, margin: "-336px 0 0 -470px", overflow: "visible", pointerEvents: "none" }}>
        <polyline className={`z-dash${f.reverse ? " rev" : ""}${s.paused ? " stop" : ""}`} points={f.route} fill="none" stroke="#111111" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <polyline className={`z-dash${s.paused ? " stop" : ""}`} points={f.branch} fill="none" stroke={ACCENT} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: f.branchOn ? 1 : 0, transition: "opacity .4s ease" }} />
      </svg>

      <div style={{ position: "absolute", left: "50%", top: "56%", width: 0, height: 0 }}>
        <div className="z-float" style={{ position: "absolute", left: `${f.nft.x}px`, top: `${f.nft.y}px`, opacity: f.nft.on ? 1 : 0, transition: "opacity .5s ease" }}>
          <div style={{ width: 156, transform: "translateY(-100%)" }}>
            <ReceiptCard f={f} />
          </div>
        </div>

        {f.pins.map((p) => (
          <span key={p.n} className={`z-pin${p.on ? " on" : ""}`} style={{ left: `${p.x}px`, top: `${p.y}px` }}>
            {p.n}
          </span>
        ))}

        <div className="z-pk" style={{ left: `${f.puck.x}px`, top: `${f.puck.y}px`, opacity: f.puck.on ? 1 : 0 }}>
          <span className="z-ring" style={{ position: "absolute", left: -24, top: -24, width: 48, height: 48, borderRadius: "50%", border: `2px solid ${f.puck.color}` }} />
          <span className="z-mono" style={{ position: "absolute", left: -19, top: -19, width: 38, height: 38, borderRadius: "50%", background: f.puck.color, border: "2px solid #111111", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 10, color: f.puck.fg, boxShadow: "0 6px 14px -4px rgba(0,0,0,.35)" }}>
            {f.puck.text}
          </span>
          <span className="z-mono" style={{ position: "absolute", left: 24, top: -30, whiteSpace: "nowrap", fontSize: 12, fontWeight: 600, background: "#FFFFFF", border: "1.5px solid #111111", padding: "4px 8px", borderRadius: 8 }}>
            {f.puck.tag}
          </span>
        </div>
      </div>
    </div>
  );
}

export function Stats() {
  const stats: Array<[string, string]> = [
    ["~230 assets", "through NEAR Intents, plus MetaMask on EVM chains"],
    ["8.6 KB", "gzipped web component, no dependencies"],
    ["Original chain", "refunds return in the coin the shopper paid with"],
    ["Public /verify", "anyone can check a receipt and that escrow covers it"],
  ];
  return (
    <section className="z-wrap" style={{ paddingTop: 56, paddingBottom: 64, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: 32 }}>
      {stats.map(([k, d]) => (
        <div key={k} className="z-col" style={{ gap: 6 }}>
          <span className="z-display" style={{ fontSize: 30, letterSpacing: "-0.03em" }}>
            {k}
          </span>
          <span style={{ fontSize: 15, color: "var(--z-muted)" }}>{d}</span>
        </div>
      ))}
    </section>
  );
}
