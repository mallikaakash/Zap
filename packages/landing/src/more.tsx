"use client";

import { useState } from "react";
import { useApp } from "./context";
import { Bolt, Mark } from "./icons";
import { RealPayButton } from "./pay-button";
import { PASS_PERIODS, passTotals, usdc2 } from "./protections";
import { Head } from "./sections";

const ACCENT = "#FF2D87";
const GITHUB = "https://github.com/mallikaakash/near-hackathon";

export function Gasless() {
  const items = [
    {
      n: "01",
      title: "Your browser makes a receipt key",
      body: "An ed25519 key, created on the shopper's device for their receipt.",
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
      title: "Only the public key goes on chain",
      body: "The private half never leaves the browser. Actions are signed right there.",
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
      title: "We relay it and pay the gas",
      body: "The server forwards the signed action. The shopper never buys NEAR.",
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
      <Head eyebrow="FOR SHOPPERS" lead="Shoppers manage their receipt, and ask for refunds, without ever setting up NEAR.">
        No NEAR wallet. <span className="z-acc">No gas.</span>
      </Head>
      <div className="z-grid" style={{ ["--min" as string]: "280px", gap: 16 }}>
        {items.map((it) => (
          <div key={it.n} className={`z-card${it.ink ? " ink" : ""}`}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ width: 56, height: 56, borderRadius: 16, background: it.iconBg, border: it.n === "02" ? "1.5px solid var(--z-edge)" : it.n === "01" ? "1px solid #333333" : undefined, display: "flex", alignItems: "center", justifyContent: "center" }}>{it.icon}</span>
              <span className="z-mono" style={{ fontSize: 13, fontWeight: 700, color: "#8A8A8A" }}>
                {it.n}
              </span>
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
        : `${MONTHS[p]} is in progress. Each month releases to the shop only once it has started.`;
  return (
    <section className="z-band">
      <div className="z-wrap z-sec">
        <Head eyebrow="PREPAID PASSES" lead="A pass releases payment to the shop one period at a time. Cancel, and every period that hasn't started comes back.">
          Subscriptions that pay out <span className="z-acc">as they&apos;re earned.</span>
        </Head>
        <div className="z-grid" style={{ ["--min" as string]: "340px", alignItems: "stretch" }}>
          <div className="z-card ink" style={{ borderRadius: 28, padding: 30, justifyContent: "space-between", gap: 28, minHeight: 300 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="z-mono z-acc" style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em" }}>
                PASS NFT · TRANSFERABLE
              </span>
              <Bolt size={22} />
            </div>
            <div className="z-col" style={{ gap: 6 }}>
              <span className="z-display" style={{ fontSize: 34, letterSpacing: "-0.03em" }}>
                Coffee Club
              </span>
              <span className="z-pm" style={{ fontSize: 15 }}>Kettle &amp; Co. · 6 months · 8 USDC a month</span>
            </div>
            <dl className="z-col" style={{ gap: 6, paddingTop: 18, borderTop: "1px solid var(--z-panel-line)", fontSize: 14, margin: 0 }} aria-live="polite">
              {(
                [
                  ["Released to shop", usdc2(t.released), "inherit"],
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
                if (i < p) [state, bg, fg, border] = ["Released to shop", "var(--z-btn)", "var(--z-btn-fg)", "var(--z-btn)"];
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
            <span className="z-muted" style={{ fontSize: 13 }}>Passes are transferable NFTs. One-time receipts aren&apos;t.</span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Dashboard() {
  const { href } = useApp();
  const nav: Array<[string, string]> = [
    ["Orders", ""],
    ["Escrow", ""],
    ["Approvals", "1"],
    ["Fulfilment", ""],
    ["Product types", ""],
    ["Button styler", ""],
    ["Settings", ""],
    ["Webhook & email logs", ""],
  ];
  const orders: Array<[string, string, string, string, string, string, string]> = [
    ["#1042", "Pour-over kit", "24.00 USDC", "ETH", "Refund approved", "#FFF3F8", "#111111"],
    ["#1041", "Burr grinder", "48.00 USDC", "BTC", "Released", "#111111", "#FFFFFF"],
    ["#1040", "Coffee Club pass", "48.00 USDC", "SOL", "Pass · 2 of 6", "#F4F4F1", "#111111"],
    ["#1039", "Paper filters", "9.00 USDC", "USDC", "Refunded", "#F4F4F1", "#5C5C5C"],
    ["#1038", "Gooseneck kettle", "33.00 USDC", "USDT", "In escrow", "#E3EAFF", "#111111"],
  ];
  const cols = "70px 1.4fr 1fr 0.8fr 1.1fr";
  return (
    <section className="z-wrap z-sec" style={{ gap: 48 }}>
      <Head center eyebrow="SELLER DASHBOARD">
        Every order. Every dollar <span className="z-acc">in escrow.</span>
      </Head>
      <figure className="z-lap">
        <div className="z-lap-in">
          <div style={{ background: "#FFFFFF", borderRadius: "12px 12px 0 0", overflow: "hidden", display: "flex", flexWrap: "wrap", minHeight: 470 }}>
            <div className="z-lap-side" style={{ flex: "0 0 210px", background: "#F7F7F5", borderRight: "1px solid #EDEDEA", padding: "20px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="z-display" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16, padding: "0 8px 14px" }}>
                <Mark size={24} radius={7} /> Kettle &amp; Co.
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
                  <span style={{ fontWeight: 700, fontSize: 14 }}>Refund #1042 · AI approved · 24.00 USDC</span>
                  <span style={{ fontSize: 13, color: "#5C5C5C" }}>“Dripper arrived cracked” · veto window closes in 5h 12m</span>
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
        <figcaption className="z-sr">Illustration of the seller dashboard with example orders.</figcaption>
      </figure>
      <div className="z-row" style={{ justifyContent: "center", gap: 10 }}>
        {["Orders", "Escrow state", "Approvals", "Fulfilment", "Product types", "Button styler", "Settings", "Webhook + email logs"].map((f) => (
          <span key={f} className="z-chip">
            {f}
          </span>
        ))}
      </div>
      <div className="z-row" style={{ justifyContent: "center" }}>
        <a className="z-btn ink" href={href("/dashboard")}>
          Open your shop&apos;s dashboard
        </a>
      </div>
    </section>
  );
}

export function Developers() {
  const specs: Array<[string, string]> = [
    ["Webhooks", "HMAC-signed, event IDs, retries"],
    ["Replay protection", "5-minute timestamp tolerance"],
    ["Email", "Notifications through Resend"],
    ["Contracts", "Rust · NEP-171 receipt NFT"],
    ["App", "Next.js · checkout, receipts, verify, dashboard"],
    ["SDK", "TypeScript web component → pay.js"],
    ["Worker", "Separate settlement service"],
  ];
  return (
    <section id="docs" className="z-rule">
      <div className="z-wrap z-sec z-grid" style={{ display: "grid", gap: 40, alignItems: "start" }}>
        <div className="z-col" style={{ gap: 28 }}>
          <div className="z-title">
            <span className="z-eyebrow">DEVELOPERS</span>
            <h2 className="z-h2">
              Built like <span className="z-acc">infrastructure.</span>
            </h2>
          </div>
          <dl className="z-col" style={{ margin: 0 }}>
            {specs.map(([k, val]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "16px 0", borderBottom: "1px solid var(--z-hair)" }}>
                <dt style={{ fontWeight: 600, fontSize: 16 }}>{k}</dt>
                <dd style={{ margin: 0, fontSize: 15, color: "var(--z-body2)", textAlign: "right" }}>{val}</dd>
              </div>
            ))}
          </dl>
          <a className="z-btn" href={`${GITHUB}#readme`} style={{ alignSelf: "flex-start" }}>
            Read the README
          </a>
        </div>
        <div className="z-col" style={{ gap: 16, minWidth: 0 }}>
          <div className="z-code">
            <div className="z-code-bar" style={{ justifyContent: "space-between" }}>
              <span>terminal</span>
              <span className="z-sim">SIMULATED</span>
            </div>
            <pre style={{ fontSize: 15, lineHeight: 1.8 }}>
              <span className="z-acc">$</span> pnpm install && pnpm demo{"\n"}
              <span className="c-cm">
                # local NEAR sandbox + mock 1Click adapter{"\n"}# the contract logic is the real one{"\n"}# no keys, no money
              </span>
            </pre>
          </div>
          <div className="z-code">
            <div className="z-code-bar">webhook.js · sketch</div>
            <pre>
              <span className="c-cm">{"// every webhook is HMAC-signed"}</span>
              {"\n"}
              <span className="c-tg">if</span> (!validHmac(rawBody, signature, secret)) <span className="c-tg">return</span> reject(){"\n"}
              <span className="c-cm">{"// 5-minute timestamp tolerance"}</span>
              {"\n"}
              <span className="c-tg">if</span> (Math.abs(now - timestamp) &gt; <span className="c-at">300</span>) <span className="c-tg">return</span> reject(){"\n"}
              <span className="c-cm">{"// event IDs make retries safe"}</span>
              {"\n"}
              <span className="c-tg">if</span> (alreadySeen(event.id)) <span className="c-tg">return</span> ok()
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Roadmap() {
  const items: Array<[string, string]> = [
    ["Shopify", "Install instead of paste."],
    ["WooCommerce", "For WordPress shops."],
    ["MCP integration", "Let agents check out with Zap."],
    ["Payouts to your chain", "Receive on the chain you prefer."],
    ["Worker in a TEE", "Settlement inside a trusted enclave."],
    ["Seller wallet signing", "Sign dashboard decisions yourself."],
    ["Photo analysis", "The assistant reads refund evidence."],
    ["Keeper-triggered releases", "Payouts that release on their own."],
  ];
  return (
    <section className="z-band">
      <div className="z-wrap" style={{ paddingTop: 72, paddingBottom: 72, display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", gap: 16 }}>
          <h2 className="z-display" style={{ fontSize: "clamp(30px, 3.4vw, 44px)", letterSpacing: "-0.03em" }}>
            What&apos;s next
          </h2>
          <span className="z-eyebrow" style={{ letterSpacing: 0 }}>
            PLANNED, NOT SHIPPED
          </span>
        </div>
        <ul style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: 12 }}>
          {items.map(([t, d]) => (
            <li key={t} className="z-col" style={{ borderRadius: 18, border: "1.5px dashed var(--z-line)", background: "var(--z-bg)", padding: 18, gap: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>{t}</span>
              <span className="z-muted" style={{ fontSize: 14, lineHeight: 1.45 }}>{d}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Cta() {
  const { merchant, mode, href } = useApp();
  return (
    <section className="z-wrap" style={{ paddingTop: 120, paddingBottom: 96, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 28 }}>
      <h2 className="z-h1" style={{ maxWidth: 980, fontSize: "clamp(40px, 6vw, 88px)" }}>
        Add the button.
        <br />
        Get paid in <span className="z-acc">USDC.</span>
      </h2>
      <code className="z-mono" style={{ fontSize: 15, background: "var(--z-soft)", borderRadius: 12, padding: "14px 20px", maxWidth: "100%", overflowX: "auto", whiteSpace: "nowrap" }}>
        &lt;pay-button merchant=&quot;{merchant || "[YOUR-SHOP].near"}&quot; amount=&quot;24&quot;&gt;&lt;/pay-button&gt;
      </code>
      <div className="z-row" style={{ justifyContent: "center", gap: 12 }}>
        <a href={href("/dashboard")} className="z-btn ink">
          <Bolt /> Get the button
        </a>
        <a href={href("/shop")} className="z-btn">
          Try the demo shop
        </a>
        <a href={GITHUB} className="z-btn">
          Read the code on GitHub
        </a>
      </div>
      {merchant ? (
        <div className="z-col" style={{ alignItems: "center", gap: 10, marginTop: 8, padding: "20px 24px", borderRadius: 20, border: "1.5px solid var(--z-line)", maxWidth: 520, background: "var(--z-bg)" }}>
          <RealPayButton merchant={merchant} amount="1" product="Test purchase" label="Try it: pay $1" color="#111111" radius="999px" />
          <span style={{ fontSize: 13, lineHeight: 1.5, color: "var(--z-muted)" }}>
            {mode === "live"
              ? "This is a real $1 payment on NEAR mainnet, held in escrow and refundable during the refund window."
              : "Simulated: no real money moves here. Swaps are mocked; the escrow contract is real."}
          </span>
        </div>
      ) : null}
    </section>
  );
}

export function Footer() {
  return (
    <footer style={{ borderTop: "1.5px solid var(--z-edge)" }}>
      <div className="z-wrap" style={{ paddingTop: 36, paddingBottom: 44, display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
          <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
            <Mark size={30} radius={8} />
            <span className="z-display" style={{ fontSize: 20 }}>
              Zap
            </span>
            <span style={{ fontSize: 14, color: "var(--z-muted)" }}>Built at the NEAR Hackathon 2026</span>
          </span>
          <nav aria-label="Footer" className="z-row" style={{ gap: 24, fontSize: 14, fontWeight: 500 }}>
            <a href="#how" style={{ textDecoration: "none", color: "var(--z-body)" }}>
              How it works
            </a>
            <a href="#refunds" style={{ textDecoration: "none", color: "var(--z-body)" }}>
              Refunds
            </a>
            <a href="#verify" style={{ textDecoration: "none", color: "var(--z-body)" }}>
              Verify
            </a>
            <a href={GITHUB} style={{ textDecoration: "none", color: "var(--z-body)" }}>
              GitHub
            </a>
          </nav>
        </div>
        <p style={{ fontSize: 13, lineHeight: 1.65, color: "var(--z-muted)", maxWidth: 900 }}>
          Zap is a hackathon prototype. The contracts are unaudited, and Zap is not a licensed money service. On mainnet, payments are capped at $50 per receipt. Pages outside live mode show a “Simulated” badge.
        </p>
      </div>
    </footer>
  );
}
