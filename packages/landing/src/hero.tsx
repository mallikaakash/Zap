"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useApp, v } from "./context";
import { DEMO } from "./demo";
import { advance, COIN_KEYS, COINS, dwell, flowView, INITIAL_FLOW, PLACES, sceneWaypoint, USDC_COLOR, type Actor, type CoinKey, type FlowState, type Pt } from "./flow";
import { Arrow, Bolt, Check, Mark } from "./icons";
import { LandingModeKicker } from "./landing-mode-kicker";
import { SiteHeader } from "./site-header";

const ACCENT = "#FF2D87";

/* Poster coordinate system (desktop). Everything in the hero is laid out here and scaled as one picture. */
const W = 1360;
const H = 700;
const SX = 840; // scene origin
const SY = 480;
const PHONE = { left: 70, top: 168, scale: 0.8 };
/* Stacked layout (narrow screens): crop of the same stage around the scene. */
const CROP = { x: 450, y: 150, w: 900, h: 560 };
const STACK_PHONE_POINT: Pt = [500, 610];
const POSTER_MIN = 980;

const toStage = (p: Pt): Pt => [SX + p[0], SY + p[1]];

export function Header() {
  return <SiteHeader section="home" />;
}

function useWidth(ref: RefObject<HTMLElement | null>) {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([e]) => setW(e?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** Height of the window left below an element's top (page coordinates), for fit-to-screen. */
function useFitHeight(ref: RefObject<HTMLElement | null>) {
  const [h, setH] = useState(10_000);
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      setH(window.innerHeight - top - 12);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [ref]);
  return h;
}

function useInView(ref: RefObject<HTMLElement | null>) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") return setSeen(true);
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen]);
  return seen;
}

/** The story state: timed steps, play/pause, scrubbing, ?still=N for stills. */
function useFlow() {
  const [s, setS] = useState<FlowState>(INITIAL_FLOW);
  const [reduced, setReduced] = useState(false);
  const [still, setStill] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const still = q.get("still");
    const coin = q.get("coin")?.toUpperCase();
    if (still !== null) {
      setStill(true);
      const step = Number(still) || 0;
      setS((x) => ({ ...x, step, mode: step > 9 ? "refund" : "pay", paused: true, coin: coin && coin in COINS ? (coin as CoinKey) : x.coin }));
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setReduced(true);
      setS((x) => ({ ...x, paused: true }));
    }
  }, []);
  useEffect(() => {
    if (s.paused) return;
    const t = setTimeout(() => setS((x) => advance(x)), dwell(s));
    return () => clearTimeout(t);
  }, [s]);
  const go = useCallback((patch: Partial<FlowState>) => setS((x) => ({ ...x, ...patch })), []);
  return { s, setS, go, reduced, still };
}

type View = ReturnType<typeof flowView>;
type Go = (patch: Partial<FlowState>) => void;

function FlowCaption({ f, go, reduced }: { f: View; go: Go; reduced: boolean }) {
  return (
    <div className="z-caption" style={{ flex: "1 1 min(100%, 520px)", maxWidth: 820 }} aria-label="How it works">
      <span className="z-mono" style={{ fontSize: 13, fontWeight: 700, background: "var(--z-btn)", color: "var(--z-btn-fg)", padding: "6px 10px", borderRadius: 8 }}>
        {f.stepNo}
      </span>
      <p aria-live="polite" className="z-display" style={{ flex: "1 1 200px", fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.3, margin: 0 }}>
        {f.cur.cap}
      </p>
      <div className="z-row" style={{ gap: 8 }}>
        <button type="button" className="z-btn sm" aria-pressed={!f.refundStory} onClick={() => go({ step: 0, mode: "pay", run: 0, paused: reduced })}>
          Payment
        </button>
        <button type="button" className="z-btn sm" aria-pressed={f.refundStory} onClick={() => go({ step: 0, mode: "pay", run: 1, paused: reduced })}>
          Refund
        </button>
      </div>
    </div>
  );
}

export function HeroFlow() {
  const { href } = useApp();
  const { s, setS, go, reduced, still } = useFlow();
  // The "try it" hint: shown until the visitor first touches the phone, never in stills.
  const [touched, setTouched] = useState(false);
  const [near, setNear] = useState(false);
  const hint: HintState = { hidden: touched || still, near, touch: () => setTouched(true), hover: setNear };
  const f = flowView(s);
  const boxRef = useRef<HTMLDivElement>(null);
  const width = useWidth(boxRef);
  const poster = width >= POSTER_MIN;
  const fitHeight = useFitHeight(boxRef);

  return (
    <section id="top" className="z-hero" aria-label="Zap: any coin in, USDC out">
      <div ref={boxRef} className="z-posterbox">
        {width === 0 ? (
          <div style={{ height: 600 }} />
        ) : poster ? (
          <Poster s={s} f={f} go={go} width={width} fitHeight={fitHeight} hint={hint} />
        ) : (
          <Stacked s={s} f={f} go={go} width={width} hint={hint} />
        )}
      </div>

      <div
        className="z-wrap"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 28,
          marginTop: poster ? 28 : 20,
        }}
      >
        <div className="z-col" style={{ flex: "1 1 280px", maxWidth: 460, gap: 20 }}>
          <p style={{ fontSize: 18, lineHeight: 1.6, color: "var(--z-body)", margin: 0 }}>
            Checkout for SaaS and online businesses. Customers pay in the assets they already hold; you receive USDC in escrow until the refund window closes.{" "}
            <a href="#refunds" style={{ color: "var(--z-fg)", fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 3 }}>
              How refunds work
            </a>
          </p>
          <div className="z-col" style={{ gap: 12, alignItems: "flex-start" }}>
            <a href={href("/dashboard")} className="z-btn ink">
              Get started <Arrow />
            </a>
            <LandingModeKicker />
          </div>
          {reduced ? (
            <p className="z-muted" style={{ fontSize: 13, margin: 0 }}>
              Walkthrough paused — your system prefers reduced motion.
            </p>
          ) : null}
        </div>
        {width > 0 ? <FlowCaption f={f} go={go} reduced={reduced} /> : null}
      </div>
    </section>
  );
}

function Headline({ style }: { style?: React.CSSProperties }) {
  return (
    <h1 className="z-h1" style={style}>
      Any coin in.
      <br />
      <span className="z-acc">USDC</span> out.
    </h1>
  );
}

interface HintState {
  hidden: boolean;
  near: boolean;
  touch: () => void;
  hover: (on: boolean) => void;
}

/** A small floating nudge beside the phone: it is a real checkout you can tap. Fades for good after the first touch. */
function TryHint({ hint, style, compact }: { hint: HintState; style?: React.CSSProperties; compact?: boolean }) {
  if (compact)
    return (
      <p className={`z-hint-pill${hint.hidden ? " gone" : ""}`} aria-hidden={hint.hidden || undefined}>
        <span className="z-hint-spark" aria-hidden="true" />
        Tap the phone to try it
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 5v14M6 13l6 6 6-6" />
        </svg>
      </p>
    );
  return (
    <div className={`z-hint${hint.hidden ? " gone" : ""}${hint.near ? " near" : ""}`} style={style} aria-hidden={hint.hidden || undefined}>
      <svg className="z-hint-arrow" width="90" height="120" viewBox="0 0 90 120" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M86 30 C 50 26, 22 52, 14 104" strokeDasharray="2 6" />
        <path d="M9.7 94.8 L14 106 L21.5 96.6" />
      </svg>
      <div className="z-hint-card" role="note">
        <b>
          <span className="z-hint-spark" aria-hidden="true" />
          Tap the phone
        </b>
        <span>Pick a coin, press Pay, and watch the money move.</span>
      </div>
    </div>
  );
}

/** Desktop: one picture. Headline top-left, phone bottom-left on the floor, scene rising to the top-right. */
function Poster({ s, f, go, width, fitHeight, hint }: { s: FlowState; f: View; go: Go; width: number; fitHeight: number; hint: HintState }) {
  // fit the whole picture in the window: by width and by the height left under the header
  const scale = Math.max(0.5, Math.min(0.92, width / W, fitHeight / H));
  // keep the headline on the same left edge as the rest of the page (40px gutter)
  const offsetX = Math.max(0, Math.min(40 - 40 * scale, width - W * scale));
  const stageRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<Pt>([PHONE.left + 125, PHONE.top + 470]);
  useLayoutEffect(() => {
    const measure = () => {
      const st = stageRef.current?.getBoundingClientRect();
      const a = anchorRef.current?.getBoundingClientRect();
      if (!st || !a || !st.width) return;
      const k = st.width / W;
      setAnchor([(a.left + a.width / 2 - st.left) / k, (a.top + a.height / 2 - st.top) / k]);
    };
    measure();
    const t = setTimeout(measure, 400);
    return () => clearTimeout(t);
  }, [width]);

  return (
    <div style={{ height: H * scale, position: "relative", overflow: "hidden" }}>
      <div ref={stageRef} className="z-poster" style={{ width: W, height: H, transform: `translate(${offsetX}px,0) scale(${scale})` }}>
        <Floor x={0} y={160} w={W} h={H - 160} />
        <Headline style={{ left: 40, top: 6, maxWidth: 720 }} />
        {/* scale and perspective live on separate elements: combined, Chromium mis-hit-tests the tilted screen */}
        <div
          style={{ position: "absolute", left: PHONE.left, top: PHONE.top, zIndex: 2, transform: `scale(${PHONE.scale})`, transformOrigin: "0 0" }}
          onPointerDown={hint.touch}
          onPointerEnter={() => hint.hover(true)}
          onPointerLeave={() => hint.hover(false)}
        >
          <div className="z-phw">
            <Phone s={s} f={f} go={go} anchorRef={anchorRef} />
          </div>
        </div>
        <TryHint hint={hint} style={{ left: 300, top: 292 }} />
        <SceneLayer s={s} f={f} phone={anchor} />
      </div>
    </div>
  );
}

/** Narrow screens: headline, then the phone, then the scene below it (mounted when it scrolls into view). */
function Stacked({ s, f, go, width, hint }: { s: FlowState; f: View; go: Go; width: number; hint: HintState }) {
  const inner = Math.min(width, 900) - 32;
  const k = inner / CROP.w;
  const sceneRef = useRef<HTMLDivElement>(null);
  const seen = useInView(sceneRef);
  const anchorRef = useRef<HTMLSpanElement>(null);
  return (
    <div className="z-wrap z-col" style={{ gap: 28, paddingTop: 12 }}>
      <Headline style={{ fontSize: "clamp(44px, 13vw, 80px)" }} />
      <TryHint hint={hint} compact />
      <div className="z-phw" style={{ alignSelf: "center", maxWidth: "100%" }} onPointerDown={hint.touch}>
        <Phone s={s} f={f} go={go} anchorRef={anchorRef} flat={width < 420} />
      </div>
      <div ref={sceneRef} aria-hidden="true" style={{ height: CROP.h * k, position: "relative", overflow: "hidden" }}>
        {seen ? (
          <div className="z-poster" style={{ width: W, height: H, transform: `scale(${k}) translate(${-CROP.x}px, ${-CROP.y}px)` }}>
            <Floor x={CROP.x} y={CROP.y} w={CROP.w} h={CROP.h} />
            <SceneLayer s={s} f={f} phone={STACK_PHONE_POINT} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Floor({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <svg className="z-floor" aria-hidden="true" style={{ left: x, top: y, width: w, height: h }} viewBox={`${x} ${y} ${w} ${h}`}>
      <defs>
        <pattern id="z-iso" width="80" height="40" patternUnits="userSpaceOnUse" patternTransform={`translate(${SX} ${SY})`}>
          <path d="M0 0 L80 40 M0 40 L80 0" stroke="var(--z-floor)" strokeWidth="1.2" fill="none" />
        </pattern>
      </defs>
      <rect x={x} y={y} width={w} height={h} fill="url(#z-iso)" />
    </svg>
  );
}

/* ---------------- the phone ---------------- */

function Phone({ s, f, go, anchorRef, flat }: { s: FlowState; f: View; go: Go; anchorRef: RefObject<HTMLSpanElement | null>; flat?: boolean }) {
  return (
    <>
      <div className="z-ph" style={flat ? { transform: "none" } : undefined}>
        <div className="z-ph-body">
          <div className="z-ph-screen">
            <div style={{ height: 34, display: "flex", justifyContent: "center", alignItems: "flex-end", flex: "none" }}>
              <span style={{ width: 92, height: 24, background: "#0E0E0E", borderRadius: 999 }} />
            </div>
            <PhoneScreen key={f.screen} s={s} f={f} go={go} />
            {/* where the Pay button sits: the coin is born here */}
            <span ref={anchorRef} aria-hidden="true" style={{ position: "absolute", left: "50%", bottom: 46, width: 2, height: 2 }} />
            <div aria-hidden="true" style={{ position: "absolute", inset: 0, borderRadius: 40, pointerEvents: "none", background: "linear-gradient(118deg, rgba(255,255,255,0) 52%, rgba(255,255,255,.22) 58%, rgba(255,255,255,0) 66%)" }} />
          </div>
        </div>
      </div>
      <div className="z-ph-shadow" aria-hidden="true" />
    </>
  );
}

function PayCta({ onClick, children, primary }: { onClick: () => void; children: React.ReactNode; primary?: boolean }) {
  return (
    <button type="button" onClick={onClick} style={{ marginTop: "auto", minHeight: 56, border: 0, borderRadius: 16, background: "#111111", color: "#FFFFFF", fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, flex: "none" }}>
      {primary ? <span className="z-seed" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

function PhoneScreen({ s, f, go }: { s: FlowState; f: View; go: Go }) {
  const coin = f.coin;
  const muted = { fontSize: 13, color: "#5C5C5C" } as const;
  if (f.screen === "shop")
    return (
      <div className="z-scr">
        <div style={{ height: 34, borderRadius: 10, background: "#F3F3F1", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#5C5C5C" }}>{DEMO.site}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span className="z-display" style={{ fontSize: 19 }}>
            {DEMO.name}
          </span>
          <span style={muted}>Upgrade</span>
        </div>
        {/* a small product dashboard, so the plan reads as software */}
        <div aria-hidden="true" style={{ height: 170, borderRadius: 20, background: "#F3F3F1", position: "relative", overflow: "hidden", flex: "none", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <span style={{ width: 54, height: 8, borderRadius: 4, background: "#111111" }} />
            <span style={{ width: 30, height: 8, borderRadius: 4, background: "#CFCFCB" }} />
          </div>
          <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 8, padding: "10px 12px", borderRadius: 12, background: "#FFFFFF", border: "1.5px solid #111111" }}>
            {[38, 58, 46, 72, 64, 90].map((h, i) => (
              <span key={i} style={{ flex: 1, height: `${h}%`, borderRadius: 4, background: i === 5 ? "#111111" : "#D9D9D4" }} />
            ))}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div className="z-col" style={{ gap: 3 }}>
            <span style={{ fontWeight: 600, fontSize: 16 }}>Pro plan</span>
            <span style={muted}>1 year · unlimited dashboards</span>
          </div>
          <span className="z-display" style={{ fontSize: 20 }}>
            $24.00
          </span>
        </div>
        <PayCta onClick={() => go({ step: 1, mode: "pay" })}>
          <Bolt /> Pay with Zap
        </PayCta>
        <span style={{ textAlign: "center", fontSize: 12, color: "#5C5C5C", marginTop: -6 }}>Any coin, any chain · you receive USDC</span>
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
        <span style={{ ...muted, marginTop: -6 }}>{DEMO.name} · Pro plan, 1 year</span>
        <div className="z-col" style={{ gap: 8 }}>
          <span id="z-paywith" style={{ fontSize: 13, fontWeight: 600 }}>
            Pay with
          </span>
          <div role="group" aria-labelledby="z-paywith" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
            {COIN_KEYS.map((k) => {
              const on = s.coin === k;
              return (
                <button key={k} type="button" aria-pressed={on} onClick={() => go({ coin: k, step: 1, mode: "pay" })} style={{ minHeight: 52, borderRadius: 14, border: `1.5px solid ${on ? "#111111" : "#E2E2DD"}`, background: on ? "#F4F4F1" : "#FFFFFF", color: "#111111", display: "flex", alignItems: "center", gap: 10, padding: "0 12px", textAlign: "left" }}>
                  <span className="z-coin" style={{ background: COINS[k].color }} />
                  <span className="z-col" style={{ gap: 1 }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{COINS[k].label}</span>
                    <span style={{ fontSize: 11, color: "#5C5C5C" }}>{COINS[k].chain}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <span style={{ fontSize: 12, color: "#5C5C5C" }}>Hundreds of assets through NEAR Intents</span>
        </div>
        <div className="z-col" style={{ gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Refund address · {coin.chain}</span>
          <span className="z-mono" style={{ minHeight: 44, borderRadius: 12, border: "1.5px solid #D6D6D1", padding: "0 12px", fontSize: 13, background: "#F7F7F5", display: "flex", alignItems: "center" }}>
            {coin.addr}
          </span>
        </div>
        <PayCta primary onClick={() => go({ step: 2, mode: "pay", run: 0 })}>
          Pay in {coin.label}
        </PayCta>
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
            <span style={muted}>{f.refundProg ? `Back to your ${coin.chain} address` : `On ${coin.chain}`}</span>
          </div>
        </div>
        <ol className="z-col" style={{ gap: 6 }}>
          {rows.map(([label, sub], i) => {
            const done = i < at;
            const now = i === at;
            return (
              <li key={label} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 12px", borderRadius: 14, background: now ? "#F4F4F1" : "transparent" }}>
                <span style={{ width: 24, height: 24, borderRadius: 999, border: `2px solid ${done || now ? "#111111" : "#D6D6D1"}`, background: done ? "#111111" : "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
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
        <button type="button" onClick={() => go({ mode: "refund", step: 8 })} style={{ marginTop: "auto", minHeight: 52, borderRadius: 16, border: "1.5px solid #111111", background: "#FFFFFF", color: "#111111", fontWeight: 600, fontSize: 15, flex: "none" }}>
          Request refund
        </button>
      </div>
    );

  return (
    <div className="z-scr" style={{ padding: "28px 22px", alignItems: "center", textAlign: "center", justifyContent: "center" }}>
      <span style={{ width: 76, height: 76, borderRadius: 999, background: f.isRefund ? coin.color : "#111111", border: "1.5px solid #111111", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Check size={34} color={f.isRefund ? "#111111" : "#FFFFFF"} width={2.6} />
      </span>
      <span className="z-display" style={{ fontSize: 23, letterSpacing: "-0.02em" }}>
        {f.isRefund ? `Refunded in ${coin.label}` : "Order confirmed"}
      </span>
      <span style={{ fontSize: 14, lineHeight: 1.55, color: "#5C5C5C" }}>
        {f.isRefund ? `Back on ${coin.chain}, to the refund address you gave at checkout.` : `${DEMO.name} is paid in USDC once the refund window ends. You paid in ${coin.label}.`}
      </span>
      <button type="button" onClick={() => go({ step: 0, mode: "pay" })} style={{ marginTop: 10, minHeight: 46, padding: "0 22px", borderRadius: 999, border: 0, background: "#111111", color: "#FFFFFF", fontWeight: 600, fontSize: 14 }}>
        Back to {DEMO.name}
      </button>
    </div>
  );
}

function ReceiptCard({ f, big, mintKey }: { f: View; big?: boolean; mintKey?: string }) {
  return (
    <div key={mintKey} className={`z-col${f.minted && !big ? " z-mint" : ""}`} style={{ borderRadius: big ? 22 : 16, background: "#111111", color: "#FFFFFF", padding: big ? 18 : "12px 14px", gap: big ? 14 : 6, boxShadow: big ? undefined : "0 14px 30px -12px rgba(0,0,0,.4)", border: "1px solid #2A2A2A" }}>
      <div className="z-mono" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: big ? 11 : 10, fontWeight: 700, letterSpacing: "0.06em" }}>
        <span className="z-acc">RECEIPT NFT</span>
        {!big && f.minted ? (
          <svg className="z-tick" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12l5 5 9-10" />
          </svg>
        ) : (
          <span style={{ color: "#BDBDBD", fontWeight: 400 }}>NEP-171</span>
        )}
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
        <div style={{ height: "100%", width: f.windowPct, background: ACCENT, transition: "width 1.2s linear" }} />
      </div>
      <span style={{ fontSize: big ? 12 : 11, color: "#D4D4D4" }}>{big ? "Refund window open" : f.minted ? "Minted on NEAR" : f.nftState}</span>
    </div>
  );
}

/* ---------------- the scene ---------------- */

const box = (w: number, h: number, d: number, c1: string, c2: string, c3: string, extra: Record<string, string> = {}) => v({ "--w": `${w}px`, "--h": `${h}px`, "--d": `${d}px`, "--c1": c1, "--c2": c2, "--c3": c3, ...extra });

function Bx({ style, front, top, right }: { style: React.CSSProperties; front?: React.ReactNode; top?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="z-bx" style={style}>
      <div className="f tp">{top}</div>
      <div className="f fr">{front}</div>
      <div className="f rt">{right}</div>
    </div>
  );
}

/** A placed object: world position, lift when active, shrink with distance. */
function Obj({ x, z, lift, k, landKey, children }: { x: number; z: number; lift: number; k: number; landKey?: string; children: React.ReactNode }) {
  return (
    <div className="z-o" style={{ transform: `translate3d(${x}px, ${lift}px, ${z}px) scale3d(${k}, ${k}, ${k})` }}>
      <div key={landKey} className={`z-in${landKey ? " z-land" : ""}`}>
        {children}
      </div>
    </div>
  );
}

function SceneLayer({ s, f, phone }: { s: FlowState; f: View; phone: Pt }) {
  const coin = f.coin;
  const P = PLACES;
  const pillar = (x: number) => <Bx style={box(18, 58, 60, "#E6E6E2", "#D4D4CF", "#BDBDB7", { "--x": `${x}px` })} />;
  const tower = (x: number) => <Bx style={box(22, 150, 66, "#3A3A3A", "#1A1A1A", "#0E0E0E", { "--x": `${x}px` })} />;

  // coin position in stage coordinates
  const liftOf = (a: Actor) => (f.active(a) && f.step > 1 ? -12 * 0.866 : 0);
  const wpStage = (wp: typeof f.puck.wp): Pt => (wp === "phone" ? phone : toStage(sceneWaypoint(wp, f.usdcCount)));
  const base = wpStage(f.puck.wp);
  const atPhone = f.puck.wp === "phone";
  const puck: Pt = atPhone ? [base[0], base[1] - (f.cur.vis ? 58 : 0)] : [base[0], base[1] + liftOf(f.puck.lift) - 16];
  const bridgeStart = toStage(f.bridgeStart);
  const nft = toStage([f.nft.x, f.nft.y]);
  const showChain = f.step === 1 || f.step === 2;

  return (
    <>
      {/* route: phone → bridge in the customer's coin, then USDC to the safe and the business, then off the edge */}
      <svg aria-hidden="true" viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0, width: W, height: H, overflow: "visible", pointerEvents: "none" }}>
        <path d={`M${phone[0]},${phone[1] - 58} Q${(phone[0] + bridgeStart[0]) / 2},${Math.min(phone[1], bridgeStart[1]) - 150} ${bridgeStart[0]},${bridgeStart[1]}`} fill="none" stroke={coin.color} strokeWidth="3" strokeDasharray="2 9" strokeLinecap="round" style={{ transition: "stroke .4s ease" }} />
        <g transform={`translate(${SX} ${SY})`}>
          <polyline points={f.route} fill="none" stroke="var(--z-fg)" strokeWidth="2.5" strokeDasharray="2 9" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
          <polyline points={f.branch} fill="none" stroke="var(--z-muted)" strokeWidth="2.5" strokeDasharray="2 9" strokeLinecap="round" style={{ opacity: f.branchOn ? 1 : 0, transition: "opacity .4s ease" }} />
        </g>
      </svg>

      <div className="z-w3" style={{ left: SX, top: SY }} aria-hidden="true">
        {/* bridge: NEAR Intents */}
        <Obj x={P.bridge.x} z={P.bridge.z} lift={f.lf.bridge} k={P.bridge.k}>
          <div className="z-gs" style={v({ "--sw": "380px", "--sh": "130px" })} />
          {pillar(-148)}
          {pillar(148)}
          {tower(-104)}
          {tower(104)}
          <Bx style={box(318, 14, 58, "#5A76FF", "#3D5AFE", "#2A42D6", { "--y": "-58px" })} top={<div style={{ position: "absolute", left: 10, right: 10, top: "50%", height: 2, marginTop: -1, background: "repeating-linear-gradient(90deg,#FFFFFF 0 16px,transparent 16px 28px)" }} />} />
          <div className="z-cab" style={{ left: -104, top: -148, width: 208, height: 72, transform: "translateZ(32px)" }} />
          <div className="z-cab" style={{ left: -104, top: -148, width: 208, height: 72, transform: "translateZ(-32px)" }} />
        </Obj>

        {/* settlement worker */}
        <Obj x={P.worker.x} z={P.worker.z} lift={f.lf.worker} k={P.worker.k}>
          <div className="z-gs" style={v({ "--sw": "130px", "--sh": "130px" })} />
          <Bx
            style={box(66, 108, 66, "#FFFFFF", "#F2F2EF", "#DCDCD6")}
            top={<div style={{ position: "absolute", inset: 10, background: "repeating-linear-gradient(90deg,#111111 0 1.5px,transparent 1.5px 7px)" }} />}
            front={
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", gap: 6, padding: "9px 7px" }}>
                {[0, 1, 2, 3].map((i) => {
                  const on = f.active("worker") && i === 1;
                  return (
                    <div key={i} style={{ height: 15, border: "1.5px solid #111111", borderRadius: 3, background: "#FFFFFF", position: "relative", flex: "none" }}>
                      <span className={on ? "z-blink" : undefined} style={{ position: "absolute", right: 4, top: 3, width: 6, height: 6, borderRadius: "50%", background: on ? "#111111" : i === 3 ? "#2EBD6B" : "#BDBDB7" }} />
                    </div>
                  );
                })}
              </div>
            }
          />
        </Obj>

        {/* receipt contract: an ink safe with a pink door (money lives here) */}
        <Obj x={P.vault.x} z={P.vault.z} lift={f.lf.vault} k={P.vault.k} landKey={f.landed ? `land-${s.run}-${s.mode}` : undefined}>
          <div className="z-gs" style={v({ "--sw": "220px", "--sh": "190px" })} />
          <Bx
            style={box(126, 126, 106, "#3A3A3A", "#1F1F1F", "#141414")}
            front={
              <>
                <div style={{ position: "absolute", inset: 11, border: "1.5px solid #0B0B0B", borderRadius: 6, background: ACCENT }} />
                <span style={{ position: "absolute", left: 4, top: 26, width: 6, height: 16, background: "#CFCFCB", borderRadius: 2 }} />
                <span style={{ position: "absolute", left: 4, bottom: 26, width: 6, height: 16, background: "#CFCFCB", borderRadius: 2 }} />
                <div style={{ position: "absolute", left: "50%", top: "50%", width: 54, height: 54, margin: "-27px 0 0 -35px", borderRadius: "50%", border: "1.5px solid #111111", background: "#FFFFFF" }}>
                  <div style={{ position: "absolute", inset: 4, borderRadius: "50%", background: "repeating-conic-gradient(#111111 0 2deg, transparent 2deg 30deg)", WebkitMask: "radial-gradient(circle, transparent 60%, #000 61%)", mask: "radial-gradient(circle, transparent 60%, #000 61%)" }} />
                  <div className="z-spin" style={{ position: "absolute", left: "50%", top: "50%", width: 2, height: 17, marginLeft: -1, background: "#111111", transformOrigin: "50% 0", transform: "rotate(180deg)" }} />
                  <span style={{ position: "absolute", left: "50%", top: "50%", width: 8, height: 8, margin: "-4px 0 0 -4px", borderRadius: "50%", background: "#111111" }} />
                </div>
                <span style={{ position: "absolute", right: 20, top: "50%", width: 8, height: 34, marginTop: -17, background: "#111111", borderRadius: 4 }} />
              </>
            }
          />
        </Obj>

        {/* refund assistant */}
        <Obj x={P.asst.x} z={P.asst.z} lift={f.lf.asst} k={P.asst.k}>
          <div className="z-gs" style={v({ "--sw": "150px", "--sh": "110px" })} />
          <Bx style={box(72, 8, 48, "#FFFFFF", "#EDEDEA", "#D8D8D2")} />
          <Bx style={box(12, 30, 10, "#D8D8D2", "#C9C9C3", "#B5B5AE", { "--y": "-8px", "--z": "-6px" })} />
          <Bx
            style={box(118, 78, 10, "#3A3A3A", "#141414", "#2A2A2A", { "--y": "-34px", "--z": "-6px" })}
            front={
              <div style={{ position: "absolute", inset: 0, padding: 9, display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ alignSelf: "flex-start", width: 62, height: 13, borderRadius: "7px 7px 7px 2px", background: "#FFFFFF" }} />
                <span style={{ alignSelf: "flex-end", width: 52, height: 13, borderRadius: "7px 7px 2px 7px", background: f.active("asst") ? "#FFFFFF" : "#5A5A5A", transition: "background-color .3s" }} />
                <span style={{ alignSelf: "flex-start", display: "flex", gap: 4, alignItems: "center" }}>
                  <span style={{ width: 13, height: 13, borderRadius: "50%", background: "#2EBD6B" }} />
                  <span style={{ width: 40, height: 6, borderRadius: 3, background: "#6A6A6A" }} />
                </span>
              </div>
            }
          />
        </Obj>

        {/* the business (payout) */}
        <Obj x={P.shop.x} z={P.shop.z} lift={f.lf.shop} k={P.shop.k}>
          <div className="z-gs" style={v({ "--sw": "250px", "--sh": "200px" })} />
          <Bx
            style={box(150, 92, 112, "#FFFFFF", "#FAFAF8", "#E6E6E1")}
            front={
              <>
                <div style={{ position: "absolute", left: 18, bottom: -1.5, width: 36, height: 56, border: "1.5px solid #111111", borderBottom: 0, background: "#F0F0EC" }}>
                  <span style={{ position: "absolute", right: 5, top: 26, width: 5, height: 5, borderRadius: "50%", background: "#111111" }} />
                </div>
                <div style={{ position: "absolute", right: 16, top: 34, width: 68, height: 38, border: "1.5px solid #111111", backgroundColor: "#E3EAFF", backgroundImage: "linear-gradient(#111111,#111111), linear-gradient(#111111,#111111)", backgroundSize: "1.5px 100%, 100% 1.5px", backgroundPosition: "center, center", backgroundRepeat: "no-repeat" }} />
                <div style={{ position: "absolute", left: 18, top: 10, width: 36, height: 18, border: "1.5px solid #111111", background: "#E3EAFF" }} />
              </>
            }
            right={<div style={{ position: "absolute", left: 30, top: 30, width: 50, height: 36, border: "1.5px solid #111111", background: "#D3DCF5" }} />}
          />
          <Bx style={box(162, 10, 122, "#2A2A2A", "#141414", "#0E0E0E", { "--y": "-92px" })} />
          <Bx
            style={box(118, 28, 6, "#111111", "#FFFFFF", "#E6E6E1", { "--y": "-102px", "--z": "20px" })}
            front={
              <div className="z-display" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, letterSpacing: "0.02em", color: "#111111" }}>
                TALLYFOX
              </div>
            }
          />
        </Obj>

        {/* USDC stack at the business */}
        <Obj x={P.stack.x} z={P.stack.z} lift={f.lf.shop} k={P.stack.k}>
          <div className="z-gs" style={v({ "--sw": "120px", "--sh": "120px" })} />
          {f.usdcDiscs.map((d, i) => (
            <div key={i} className="z-dk" style={v({ "--s": "58px", "--y": `${d.y}px`, "--c": d.c })}>
              {d.t}
            </div>
          ))}
        </Obj>
      </div>

      {/* overlays in stage coordinates */}
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {f.pins.map((p) => {
          const [x, y] = toStage([p.x, p.y]);
          return (
            <span key={p.n} className={`z-pin${p.on ? " on" : ""}`} style={{ left: x, top: y }}>
              {p.n}
              <span>{p.label}</span>
            </span>
          );
        })}

        {showChain ? (
          <span className="z-pin on" style={{ left: phone[0] + 150, top: phone[1] - 150, zIndex: 4, background: "var(--z-bg)", color: "var(--z-fg)", border: "1.5px solid var(--z-edge)" }}>
            <span className="z-coin" style={{ width: 14, height: 14, background: coin.color }} />
            <span>
              {coin.label} on {coin.chain}
            </span>
          </span>
        ) : null}

        <div style={{ position: "absolute", left: nft[0], top: nft[1], opacity: f.nft.on ? 1 : 0, transition: "opacity .5s ease" }}>
          <div style={{ width: 160, transform: "translateY(-100%)" }}>
            <ReceiptCard f={f} mintKey={f.minted ? `mint-${s.run}-${s.mode}` : "nft"} />
          </div>
        </div>

        {f.tapped ? <span key={`tap-${s.run}-${s.coin}`} className="z-tap" style={{ left: phone[0], top: phone[1] }} /> : null}

        <div className={`z-pk${f.tapped ? " born" : ""}`} style={{ left: puck[0], top: puck[1], opacity: f.puck.on ? 1 : 0 }}>
          <span className="z-mono" style={{ position: "absolute", left: -19, top: -19, width: 38, height: 38, borderRadius: "50%", background: f.puck.color, border: "2px solid #111111", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 10, color: f.puck.fg, boxShadow: "0 8px 16px -6px rgba(0,0,0,.45)" }}>
            {f.puck.text}
          </span>
          <span className="z-mono" style={{ position: "absolute", left: 26, top: -32, whiteSpace: "nowrap", fontSize: 12, fontWeight: 700, background: ACCENT, color: "#111111", padding: "4px 9px", borderRadius: 8 }}>
            {f.puck.tag}
          </span>
        </div>
      </div>
    </>
  );
}
