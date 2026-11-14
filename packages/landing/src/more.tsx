"use client";

import { useState } from "react";
import { useApp } from "./context";
import { DEMO, DEMO_ORDER } from "./demo";
import { LogoWordmark, LogoMark } from "./brand";
import { Bolt } from "./icons";
import { PASS_PERIODS, passTotals, usdc2 } from "./protections";
import { Head } from "./sections";
import { ZAP_GITHUB } from "./site-links";

const ACCENT = "#FF5A0D";

export function Gasless() {
  const items = [
    {
      n: "01",
      title: "Receipt key in the browser",
      body: "Customers get a private key for their receipt on the device they paid from.",
      ink: false,
      icon: (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="8" cy="15" r="4" />
          <path d="M11 12l9-9M17 6l3 3M14 9l2 2" />
        </svg>
      ),
      iconBg: "#111111",
    },
    {
      n: "02",
      title: "Sign actions locally",
      body: "Refund requests are signed in the browser. Secrets never leave the customer.",
      ink: false,
      icon: (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="11" width="18" height="10" rx="2" />
          <path d="M7 11V8a5 5 0 0 1 10 0v3" />
        </svg>
      ),
      iconBg: "var(--z-soft)",
    },
    {
      n: "03",
      title: "No gas for customers",
      body: "Zap relays the signed action and covers NEAR gas. No wallet setup required.",
      ink: true,
      icon: (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#111111" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 21h12V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v16zM15 9h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V8l-3-3M6 8h6" />
        </svg>
      ),
      iconBg: ACCENT,
    },
  ];
  return (
    <section className="z-wrap z-sec">
      <Head eyebrow="FOR YOUR CUSTOMERS" lead="Customers manage their receipt, and ask for refunds, without ever setting up NEAR.">
        No NEAR wallet. <span className="z-acc">No gas.</span>
      </Head>
      <div className="z-grid z-reveal-stagger" style={{ ["--min" as string]: "280px", gap: 16 }}>
        {items.map((it) => (
          <div key={it.n} className={`z-card${it.ink ? " ink" : ""}`}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ width: 56, height: 56, borderRadius: 16, background: it.iconBg, border: it.n === "02" ? "1.5px solid var(--z-edge)" : it.n === "01" ? "1px solid #333333" : undefined, display: "flex", alignItems: "center", justifyContent: "center" }}>{it.icon}</span>
            </div>
            <h3 className="z-display" style={{ fontSize: 24, letterSpacing: "-0.02em", lineHeight: 1.15 }}>
              {it.title}
            </h3>
            <p className={it.ink ? "z-pm" : undefined} style={{ fontSize: 15, lineHeight: 1.55, color: it.ink ? undefined : "var(--z-body2)" }}>{it.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN"];

export function Passes() {
  const [p, setP] = useState(2);
  const [cancelled, setCancelled] = useState(false);
  const t = passTotals(p, cancelled);
  const caption =
    p >= PASS_PERIODS
      ? "All six months released. The pass ran its full course."
      : cancelled
        ? `Cancelled in ${MONTHS[p]}. That month finishes, and ${usdc2(t.returned)} USDC for the months not started goes back.`
        : `${MONTHS[p]} is in progress. Each month releases to the business only once it has started.`;
  return (
    <section className="z-band">
      <div className="z-wrap z-sec">
        <Head eyebrow="PREPAID PLANS" lead="A prepaid plan releases payment to you one billing period at a time. If the customer cancels, every period that hasn't started goes back to them.">
          Subscriptions that pay out <span className="z-acc">as they&apos;re earned.</span>
        </Head>
        <div className="z-grid" style={{ ["--min" as string]: "340px", alignItems: "stretch" }}>
          <div className="z-card ink" style={{ borderRadius: 28, padding: 30, justifyContent: "space-between", gap: 28, minHeight: 300 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="z-mono z-acc" style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em" }}>
                PLAN PASS · TRANSFERABLE
              </span>
              <Bolt size={22} />
            </div>
            <div className="z-col" style={{ gap: 6 }}>
              <span className="z-display" style={{ fontSize: 34, letterSpacing: "-0.03em" }}>
                Team plan
              </span>
              <span className="z-pm" style={{ fontSize: 15 }}>{DEMO.name} · 6 months · 8 USDC a month</span>
            </div>
            <dl className="z-col" style={{ gap: 6, paddingTop: 18, borderTop: "1px solid var(--z-panel-line)", fontSize: 14, margin: 0 }} aria-live="polite">
              {(
                [
                  ["Released to you", usdc2(t.released), "inherit"],
                  ["Still in escrow", usdc2(t.escrow), "inherit"],
                  ["Returned to you", usdc2(t.returned), ACCENT],
                ] as const
              ).map(([k, val, c]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                  <dt className="z-pm">{k}</dt>
                  <dd className="z-mono" style={{ margin: 0, fontWeight: 700, color: c }}>
                    {val} USDC
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="z-card" style={{ borderRadius: 28, padding: 30, gap: 24 }}>
            <ol style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 8 }}>
              {MONTHS.map((m, i) => {
                let state: string, bg: string, fg: string, border: string;
                if (i < p) [state, bg, fg, border] = ["Released to you", "var(--z-btn)", "var(--z-btn-fg)", "var(--z-btn)"];
                else if (i === p && p < PASS_PERIODS) [state, bg, fg, border] = [cancelled ? "Finishing, then released" : "In progress", ACCENT, "#111111", "#111111"];
                else if (cancelled) [state, bg, fg, border] = ["Returned to you", "var(--z-soft)", "var(--z-muted)", "var(--z-line)"];
                else [state, bg, fg, border] = ["Upcoming, in escrow", "var(--z-bg)", "var(--z-fg)", "var(--z-line)"];
                return (
                  <li key={m} className="z-cell" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 18, minHeight: 120, padding: "12px 8px", borderRadius: 16, border: `1.5px solid ${border}`, background: bg, color: fg, minWidth: 0 }}>
                    <span className="z-mono" style={{ fontSize: 12, fontWeight: 700 }}>
                      {m}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3, overflowWrap: "anywhere" }}>{state}</span>
                  </li>
                );
              })}
            </ol>
            <p aria-live="polite" className="z-display" style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.35 }}>
              {caption}
            </p>
            <div className="z-row" style={{ gap: 8, marginTop: "auto" }}>
              <button type="button" className="z-btn ink sm" disabled={p >= PASS_PERIODS} onClick={() => setP((x) => Math.min(PASS_PERIODS, x + 1))}>
                Next month
              </button>
              <button type="button" className="z-btn acc sm" disabled={cancelled || p >= PASS_PERIODS} onClick={() => setCancelled(true)}>
                Cancel pass
              </button>
              <button
                type="button"
                className="z-btn sm"
                onClick={() => {
                  setP(2);
                  setCancelled(false);
                }}
              >
                Reset
              </button>
            </div>
            <span className="z-muted" style={{ fontSize: 13 }}>Plan passes are transferable NFTs, so a seat can change hands. One-time receipts aren&apos;t.</span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Dashboard() {
  const nav: Array<[string, string]> = [
    ["Orders", ""],
    ["Escrow", ""],
    ["Approvals", "1"],
    ["Settings", ""],
  ];
  const orders: Array<[string, string, string, string, string, string, string]> = [
    [`#${DEMO_ORDER.id}`, DEMO_ORDER.productLine, DEMO_ORDER.usdc, "ETH", "Refund approved", "#FFF3F8", "#111111"],
    ["#1041", "Team plan · 6 seats", "48.00 USDC", "BTC", "Released", "#111111", "#FFFFFF"],
    ["#1039", "API credits · 10k", "9.00 USDC", "USDC", "Refunded", "#F4F4F1", "#5C5C5C"],
    ["#1038", "Onboarding package", "33.00 USDC", "USDT", "In escrow", "#E3EAFF", "#111111"],
  ];
  const cols = "70px 1.4fr 1fr 0.8fr 1.1fr";
  return (
    <section className="z-wrap z-sec" style={{ gap: 48 }}>
      <Head center eyebrow="MERCHANT DASHBOARD">
        Every order. Every dollar <span className="z-acc">in escrow.</span>
      </Head>
      <figure className="z-lap">
        <div className="z-lap-in">
          <div style={{ background: "#FFFFFF", borderRadius: "12px 12px 0 0", overflow: "hidden", display: "flex", flexWrap: "wrap", minHeight: 470 }}>
            <div className="z-lap-side" style={{ flex: "0 0 210px", background: "#F7F7F5", borderRight: "1px solid #EDEDEA", padding: "20px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="z-display" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16, padding: "0 8px 14px" }}>
                <LogoMark size={24} /> {DEMO.name}
              </span>
              {nav.map(([t, b], i) => (
                <span key={t} style={{ padding: "9px 10px", borderRadius: 9, fontSize: 14, fontWeight: i === 0 ? 600 : 500, background: i === 0 ? "#F0F0EC" : "transparent", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  {t}
                  <span className="z-mono" style={{ fontSize: 11, fontWeight: 700, color: "#C2185B" }}>
                    {b}
                  </span>
                </span>
              ))}
            </div>
            <div style={{ flex: "999 1 420px", padding: 24, display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                {(
                  [
                    ["In escrow", "117.00 USDC", false],
                    ["Released", "48.00 USDC", false],
                    ["Needs you", "1 approval", true],
                  ] as const
                ).map(([k, val, hot]) => (
                  <div key={k} className="z-col" style={{ borderRadius: 14, border: `1px solid ${hot ? ACCENT : "#EDEDEA"}`, background: hot ? "#FFF3F8" : "#FFFFFF", padding: 14, gap: 4 }}>
                    <span style={{ fontSize: 12, color: "#5C5C5C" }}>{k}</span>
                    <span className="z-display" style={{ fontSize: 22 }}>
                      {val}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ borderRadius: 14, border: "1.5px solid #111111", padding: "14px 16px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div className="z-col" style={{ gap: 3 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>
                    Refund #{DEMO_ORDER.id} · AI approved · {DEMO_ORDER.usdc}
                  </span>
                  <span style={{ fontSize: 13, color: "#5C5C5C" }}>“Charged twice for Pro” · veto window closes in 5h 12m</span>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <span style={{ padding: "8px 14px", borderRadius: 999, border: "1.5px solid #111111", fontSize: 13, fontWeight: 600 }}>Veto</span>
                  <span style={{ padding: "8px 14px", borderRadius: 999, background: "#111111", color: "#FFFFFF", fontSize: 13, fontWeight: 600 }}>Approve now</span>
                </div>
              </div>
              <div style={{ overflowX: "auto" }}>
                <div style={{ minWidth: 520, display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "grid", gridTemplateColumns: cols, gap: 10, padding: "0 6px 10px", fontSize: 12, color: "#5C5C5C", fontWeight: 600, borderBottom: "1px solid #EDEDEA" }}>
                    <span>Order</span>
                    <span>Product</span>
                    <span>Amount</span>
                    <span>Paid in</span>
                    <span>Status</span>
                  </div>
                  {orders.map(([id, prod, amt, coin, st, bg, fg]) => (
                    <div key={id} style={{ display: "grid", gridTemplateColumns: cols, gap: 10, padding: "12px 6px", fontSize: 14, borderBottom: "1px solid #F2F2EF", alignItems: "center" }}>
                      <span className="z-mono" style={{ fontSize: 13 }}>
                        {id}
                      </span>
                      <span style={{ fontWeight: 500 }}>{prod}</span>
                      <span className="z-mono" style={{ fontSize: 13 }}>
                        {amt}
                      </span>
                      <span className="z-mono" style={{ fontSize: 13 }}>
                        {coin}
                      </span>
                      <span style={{ justifySelf: "start", fontSize: 12, fontWeight: 600, padding: "5px 10px", borderRadius: 999, background: bg, color: fg }}>{st}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div aria-hidden="true" style={{ width: "100%", maxWidth: 1180, height: 22, background: "#D9D9D4", borderRadius: "0 0 22px 22px", position: "relative", borderTop: "2px solid #BDBDB7" }}>
          <span style={{ position: "absolute", left: "50%", top: 0, width: 140, height: 8, marginLeft: -70, background: "#C6C6C0", borderRadius: "0 0 10px 10px" }} />
        </div>
        <figcaption className="z-sr">Illustration of the merchant dashboard with example orders.</figcaption>
      </figure>
      <div className="z-row" style={{ justifyContent: "center", gap: 10 }}>
        {["Orders", "Escrow", "Approvals", "Settings"].map((f) => (
          <span key={f} className="z-chip">
            {f}
          </span>
        ))}
      </div>
    </section>
  );
}

export function Footer() {
  const { href } = useApp();
  return (
    <footer style={{ borderTop: "1.5px solid var(--z-edge)" }}>
      <div className="z-wrap" style={{ paddingTop: 36, paddingBottom: 44, display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
          <LogoWordmark height={52} />
          <nav aria-label="Footer" className="z-row" style={{ gap: 24, fontSize: 14, fontWeight: 500 }}>
            <a href={href("/dashboard")} style={{ textDecoration: "none", color: "var(--z-body)" }}>
              Get started
            </a>
            <a href="#refunds" style={{ textDecoration: "none", color: "var(--z-body)" }}>
              Refunds
            </a>
            <a href="#verify" style={{ textDecoration: "none", color: "var(--z-body)" }}>
              Verify
            </a>
            <a href={href("/docs")} style={{ textDecoration: "none", color: "var(--z-body)" }}>
              Docs
            </a>
            <a href={href("/shop")} style={{ textDecoration: "none", color: "var(--z-body)" }}>
              Demo checkout
            </a>
          </nav>
        </div>
        <p style={{ fontSize: 13, lineHeight: 1.65, color: "var(--z-muted)" }}>
          © {new Date().getFullYear()} Zap ·{" "}
          <a href={href("/docs")} style={{ color: "inherit" }}>
            Documentation
          </a>
        </p>
      </div>
    </footer>
  );
}
