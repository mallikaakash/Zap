"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useApp } from "./context";
import { DEMO, DEMO_ORDER } from "./demo";
import { Bolt, Check, Cross } from "./icons";
import { RealPayButton } from "./pay-button";
import { evaluate, INITIAL_PROTECTIONS, nudge, REQUEST, type ProtectionIdx, type Tone } from "./protections";

const ACCENT = "#FF2D87";

export function Head({ eyebrow, children, lead, xl, center }: { eyebrow: string; children: React.ReactNode; lead?: React.ReactNode; xl?: boolean; center?: boolean }) {
  return (
    <div className="z-head" style={center ? { justifyContent: "center", textAlign: "center" } : undefined}>
      <div className="z-title" style={center ? { alignItems: "center" } : undefined}>
        <span className="z-eyebrow">{eyebrow}</span>
        <h2 className={`z-h2${xl ? " xl" : ""}`}>{children}</h2>
      </div>
      {lead ? <p className="z-lead">{lead}</p> : null}
    </div>
  );
}

/* ---------------- problem ---------------- */

export function Problem() {
  const line = { fontFamily: "var(--z-display)", fontSize: "clamp(18px, 2vw, 22px)", fontWeight: 600, letterSpacing: "-0.02em" } as const;
  const big = { fontFamily: "var(--z-display)", fontWeight: 700, fontSize: "clamp(64px, 8vw, 120px)", lineHeight: 0.9, letterSpacing: "-0.06em" } as const;
  return (
    <section className="z-wrap z-sec">
      <Head eyebrow="WHY ZAP" lead="Customers shouldn’t bridge, swap, or learn your stack just to pay you.">
        Checkout they can finish. <span className="z-acc">Refunds</span> that work.
      </Head>
      <div className="z-grid" style={{ ["--min" as string]: "320px" }}>
        <div className="z-card soft" style={{ borderRadius: 28, gap: 26 }}>
          <span className="z-eyebrow" style={{ letterSpacing: 0 }}>
            THE USUAL CRYPTO CHECKOUT
          </span>
          <div className="z-col" style={{ gap: 6 }}>
            <span style={{ ...big, color: "var(--z-muted)" }}>0</span>
            <span style={{ ...line, color: "var(--z-muted)" }}>refunds, once it&apos;s paid</span>
          </div>
          <ul className="z-col" style={{ gap: 16 }}>
            {["Bridge to our chain first", "Hold the one token we accept", "Paid means final"].map((b) => (
              <li key={b} style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ width: 30, height: 30, borderRadius: 999, border: "1.5px solid var(--z-muted)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  <Cross size={12} color="currentColor" />
                </span>
                <span style={{ ...line, fontSize: 18, color: "var(--z-muted)", textDecoration: "line-through", textDecorationThickness: 2 }}>{b}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="z-card ink" style={{ borderRadius: 28, gap: 26 }}>
          <span className="z-mono z-acc" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600 }}>
            <Bolt size={14} /> ZAP
          </span>
          <div className="z-col" style={{ gap: 6 }}>
            <span style={big}>Any chain</span>
            <span style={line}>refunds go back where they came from</span>
          </div>
          <ul className="z-col" style={{ gap: 16 }}>
            {["Pay in whatever you already hold", "The business always gets USDC", "A refund button that works"].map((g) => (
              <li key={g} style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ width: 30, height: 30, borderRadius: 999, background: ACCENT, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  <Check size={14} color="#111111" width={3} />
                </span>
                <span style={{ ...line, fontSize: 18 }}>{g}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ---------------- drop-in ---------------- */

const COLORS = {
  ink: { name: "Ink", bg: "#111111", fg: "#FFFFFF", bolt: ACCENT },
  pink: { name: "Pink", bg: ACCENT, fg: "#111111", bolt: "#111111" },
  blue: { name: "Blue", bg: "#2F7BFF", fg: "#FFFFFF", bolt: "#FFFFFF" },
  white: { name: "White", bg: "#FFFFFF", fg: "#111111", bolt: ACCENT },
} as const;
const RADII = { square: ["Square", "6px"], rounded: ["Rounded", "14px"], pill: ["Pill", "999px"] } as const;
const LABELS = ["Pay with Zap", "Pay with crypto", "Checkout"];

export function DropIn() {
  const { host, merchant, payJsGzip, href, mode } = useApp();
  const [color, setColor] = useState<keyof typeof COLORS>("ink");
  const [radius, setRadius] = useState<keyof typeof RADII>("pill");
  const [label, setLabel] = useState(0);
  const col = COLORS[color];
  const shop = merchant || "your-business.near";
  // The snippet mirrors the styler, so a seller can copy exactly what they see.
  const attrs: string[] = [`merchant="${shop}"`, `amount="24"`, `product="Pro plan"`, `color="${col.bg}"`];
  if (radius !== "rounded") attrs.push(`radius="${RADII[radius][1]}"`);
  if (label !== 0) attrs.push(`label="${LABELS[label]}"`);
  const kb = payJsGzip ? `${(payJsGzip / 1000).toFixed(1)} kB gzipped` : "Small, gzipped";

  return (
    <section id="start" className="z-wrap z-sec" style={{ paddingTop: 32, paddingBottom: 64 }}>
      <Head
        eyebrow="GET STARTED"
        lead="Register your shop in the dashboard, paste the snippet, and you're live. Hosted checkout—no keys on your site."
      >
        Embed Zap on your <span className="z-acc">site.</span>
      </Head>
      <div className="z-grid">
        <div className="z-code" style={{ borderRadius: 24 }}>
          <div className="z-code-bar">
            <span className="z-dots">
              <i />
              <i />
              <i />
            </span>
            <span style={{ marginLeft: 10 }}>checkout.html</span>
          </div>
          <pre style={{ fontSize: 15 }}>
            <span className="c-cm">&lt;!-- 1. load the component --&gt;</span>
            {"\n"}
            <span className="c-tg">&lt;script</span> <span className="c-at">src</span>=<span className="c-st">&quot;{host || "https://[YOUR-ZAP-HOST]"}/pay.js&quot;</span> <span className="c-at">defer</span>
            <span className="c-tg">&gt;&lt;/script&gt;</span>
            {"\n\n"}
            <span className="c-cm">&lt;!-- 2. drop the button --&gt;</span>
            {"\n"}
            <span className="c-tg">&lt;pay-button</span>
            {attrs.map((a) => {
              const [k, val] = a.split("=");
              return (
                <span key={a}>
                  {"\n  "}
                  <span className="c-at">{k}</span>=<span className="c-st">{val}</span>
                </span>
              );
            })}
            <span className="c-tg">&gt;&lt;/pay-button&gt;</span>
            {"\n\n"}
            <span className="c-cm">{"// 3. listen for payment events, then fulfil the order"}</span>
            {"\n"}
            button.<span className="c-at">addEventListener</span>(<span className="c-st">&apos;uc:paid&apos;</span>, showThanks)
          </pre>
        </div>
        <div className="z-card" style={{ gap: 22 }}>
          <div style={{ flex: 1, minHeight: 210, borderRadius: 18, background: "var(--z-soft)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 24 }}>
            <span className="z-muted" style={{ fontSize: 14 }}>
              {DEMO_ORDER.productShort} · {DEMO_ORDER.amountDisplay}
            </span>
            <span aria-label={`Button preview: ${LABELS[label]}`} style={{ minHeight: 54, padding: "0 26px", borderRadius: RADII[radius][1], background: col.bg, color: col.fg, border: "1.5px solid #111111", fontWeight: 700, fontSize: 16, display: "inline-flex", alignItems: "center", gap: 9, transition: "all .25s ease" }}>
              <Bolt color={col.bolt} />
              {LABELS[label]}
            </span>
            <span className="z-mono z-muted" style={{ fontSize: 11, textAlign: "center" }}>
              Button preview · styles won&apos;t clash with your site
            </span>
          </div>
          <div className="z-col" style={{ gap: 14 }}>
            <div className="z-row" role="group" aria-label="Colour" style={{ gap: 10 }}>
              <span style={{ width: 70, fontSize: 13, fontWeight: 600 }}>Colour</span>
              {(Object.keys(COLORS) as Array<keyof typeof COLORS>).map((k) => (
                <button key={k} type="button" className="z-swatch" aria-pressed={color === k} aria-label={COLORS[k].name} onClick={() => setColor(k)}>
                  <span style={{ display: "block", width: "100%", height: "100%", borderRadius: 999, background: COLORS[k].bg, border: "1px solid #D6D6D1" }} />
                </button>
              ))}
            </div>
            <div className="z-row" role="group" aria-label="Corners" style={{ gap: 8 }}>
              <span style={{ width: 70, fontSize: 13, fontWeight: 600 }}>Corners</span>
              {(Object.keys(RADII) as Array<keyof typeof RADII>).map((k) => (
                <button key={k} type="button" className="z-seg" aria-pressed={radius === k} onClick={() => setRadius(k)}>
                  {RADII[k][0]}
                </button>
              ))}
            </div>
            <div className="z-row" role="group" aria-label="Label" style={{ gap: 8 }}>
              <span style={{ width: 70, fontSize: 13, fontWeight: 600 }}>Label</span>
              {LABELS.map((l, i) => (
                <button key={l} type="button" className="z-seg" aria-pressed={label === i} onClick={() => setLabel(i)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="z-row" style={{ gap: 10, flexWrap: "wrap" }}>
        {[kb, "No dependencies", "Hosted checkout", "Themable"].map((s) => (
          <span key={s} className="z-chip">
            {s}
          </span>
        ))}
      </div>
      <div className="z-row" style={{ gap: 10, flexWrap: "wrap", marginTop: 8 }}>
        <a className="z-btn ink" href={href("/dashboard")}>
          <Bolt /> Open dashboard
        </a>
        <a className="z-btn" href={href("/docs")}>
          Documentation
        </a>
        <a className="z-btn" href={href("/docs/quickstart")}>
          Quickstart
        </a>
      </div>
      {merchant ? (
        <div className="z-col" style={{ alignItems: "center", gap: 12, marginTop: 28, paddingTop: 28, borderTop: "1.5px solid var(--z-line)" }}>
          <h3 className="z-display" style={{ fontSize: 22, letterSpacing: "-0.02em", margin: 0, textAlign: "center" }}>
            Try a live button
          </h3>
          <div className="z-col" style={{ alignItems: "center", gap: 10, padding: "20px 24px", borderRadius: 20, border: "1.5px solid var(--z-line)", maxWidth: 520, width: "100%", background: "var(--z-bg)" }}>
            <RealPayButton merchant={merchant} amount="1" product="Test purchase" label="Try it: pay $1" color="#111111" radius="999px" />
            <span style={{ fontSize: 13, lineHeight: 1.5, color: "var(--z-muted)", textAlign: "center" }}>
              {mode === "live" ? "Live checkout on NEAR mainnet." : "Sandbox checkout — no real funds."}
            </span>
          </div>
          <a className="z-btn sm" href={href("/shop")}>
            Open demo checkout
          </a>
        </div>
      ) : null}
    </section>
  );
}

/* ---------------- any coin ---------------- */

const ASSETS: Array<[string, string, string]> = [
  ["BTC", "Bitcoin", "#FFB23F"],
  ["ETH", "Ethereum", "#9AA0FF"],
  ["SOL", "Solana", "#3FE0A5"],
  ["USDC", "Base", "#2F7BFF"],
  ["USDT", "Tron", "#48C9A0"],
  ["ARB", "Arbitrum", "#7FB2FF"],
  ["DOGE", "Dogecoin", "#E8C66A"],
  ["XRP", "XRP Ledger", "#BDBDBD"],
  ["ZEC", "Zcash", "#F4B728"],
  ["BNB", "BNB Chain", "#F3BA2F"],
  ["NEAR", "NEAR", "#FFFFFF"],
  ["POL", "Polygon", "#A98BFF"],
  ["TON", "TON", "#5EC8FF"],
  ["SUI", "Sui", "#6FB8FF"],
  ["USDC", "Ethereum", "#2F7BFF"],
  ["USDT", "Ethereum", "#48C9A0"],
];

function Marquee({ items, reverse }: { items: Array<[string, string, string]>; reverse?: boolean }) {
  const doubled = items.concat(items);
  return (
    <div className={`z-mq${reverse ? " r" : ""}`}>
      {doubled.map(([t, n, c], i) => (
        <span key={i} className="z-asset">
          <span className="z-coin" style={{ background: c }} />
          <span className="z-mono" style={{ fontSize: 15, fontWeight: 700 }}>
            {t}
          </span>
          <span className="z-muted" style={{ fontSize: 14 }}>
            {n}
          </span>
        </span>
      ))}
    </div>
  );
}

export function AnyCoin() {
  const { href, payJsGzip } = useApp();
  const [tokens, setTokens] = useState<{ n: number; chains: number } | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    fetch(href("/api/tokens"))
      .then((r) => (r.ok ? (r.json() as Promise<{ tokens: Array<{ chain?: string }> }>) : Promise.reject(new Error(String(r.status)))))
      .then((r) => live && setTokens({ n: r.tokens.length, chains: new Set(r.tokens.map((t) => t.chain)).size }))
      .catch(() => live && setTokens(null));
    return () => {
      live = false;
    };
  }, [href]);
  const kb = payJsGzip ? `${(payJsGzip / 1000).toFixed(1)} kB pay.js` : null;
  const marquee = ASSETS.slice(0, 10);
  return (
    <section className="z-rule" style={{ paddingTop: 96, paddingBottom: 96, display: "flex", flexDirection: "column", gap: 44, overflow: "hidden" }}>
      <div className="z-wrap" style={{ width: "100%" }}>
        <Head eyebrow="ANY COIN" lead="Quotes lock the USDC you priced. Settlement goes straight into escrow on NEAR.">
          Pay in what they hold. <span className="z-acc">Settle</span> in USDC.
        </Head>
      </div>
      <div role="img" aria-label="Sample assets: Bitcoin, Ethereum, Solana, USDC, and more">
        <Marquee items={marquee} />
      </div>
      <div className="z-wrap z-col" style={{ width: "100%", gap: 14 }}>
        <div className="z-grid" style={{ ["--min" as string]: "280px", gap: 16 }}>
          {(
            [
              ["EVM CHAINS", "Pay with MetaMask", "Connect, approve, done. The quote is already locked.", false],
              ["EVERY OTHER CHAIN", "Deposit address + QR", "Send from any wallet or exchange. 1Click handles the swap.", false],
              ["ALREADY USDC ON NEAR", "Send it directly", "No swap at all. It goes straight into escrow.", true],
            ] as const
          ).map(([k, t, d, ink]) => (
            <div key={k} className={`z-card${ink ? " ink" : ""}`} style={{ borderRadius: 22, gap: 10, padding: 26 }}>
              <span className={`z-mono ${ink ? "z-acc" : "z-muted"}`} style={{ fontSize: 12, fontWeight: 600 }}>
                {k}
              </span>
              <span className="z-display" style={{ fontSize: 26, letterSpacing: "-0.02em" }}>
                {t}
              </span>
              <span className={ink ? "z-pm" : undefined} style={{ fontSize: 15, lineHeight: 1.55, color: ink ? undefined : "var(--z-body2)" }}>
                {d}
              </span>
            </div>
          ))}
        </div>
        <p className="z-muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.55 }}>
          {tokens === undefined ? "Loading supported assets…" : tokens ? `${tokens.n}+ assets on ${tokens.chains} chains` : "Hundreds of assets"}
          {kb ? ` · ${kb}` : ""}
          {" · "}
          <a href={href("/verify")} style={{ color: "inherit", fontWeight: 600 }}>
            Public receipt lookup
          </a>
          {" · "}
          <a href={href("/docs")} style={{ color: "inherit", fontWeight: 600 }}>
            Checkout docs
          </a>
        </p>
      </div>
    </section>
  );
}

/* ---------------- refunds: two beats ---------------- */

type Msg = [who: string, text: string, shopper: boolean, photo: boolean];
const SCENARIOS = {
  // Each story follows what the refund assistant really does (packages/core/src/refund-agent.ts).
  approve: {
    name: "Approve",
    dot: "#1F9D57",
    verdict: "APPROVED",
    vBg: "#1F9D57",
    vFg: "#FFFFFF",
    chat: [
      ["Customer", "Exports are not working since I upgraded to Pro.", true, false],
      ["Refund assistant", "Sorry about that. What exactly is broken or not working? Please add a screenshot that shows it.", false, false],
      ["Customer", "Every export fails with an error. Screenshot attached.", true, true],
      ["Refund assistant", `Thanks. A feature that doesn’t work is covered by ${DEMO.possessive} refund policy, and this is within what I can approve. Approved: 24.00 USDC goes back to you as ETH.`, false, false],
    ] as Msg[],
    route: [
      ["24.00 USDC in escrow", "Held by receipt NFT #1042", true],
      ["Business veto window", `${DEMO.name} can still step in`, true],
      ["1Click swap back", "Quote ID logged on chain", true],
      ["ETH on Ethereum", "To 0x8f3a…c21a, the refund address", true],
    ] as Array<[string, string, boolean]>,
    outTitle: "Approve: clear, small cases",
    outBody: "The assistant approves within your guard threshold and auto-approve limit. AI approvals still wait out your veto window before the refund executes.",
  },
  deny: {
    name: "Deny",
    dot: "#8A8A8A",
    verdict: "DENIED · 1 APPEAL",
    vBg: "var(--z-btn)",
    vFg: "var(--z-btn-fg)",
    chat: [
      ["Customer", "We don’t need it anymore. Can I get a refund?", true, false],
      ["Refund assistant", `${DEMO.possessive} policy refunds something that is broken, never activated or not as described, but not a change of mind, so I can’t approve this. You can appeal once and ${DEMO.name} will review it.`, false, false],
    ] as Msg[],
    route: [
      ["24.00 USDC in escrow", "Nothing moves", true],
      ["Appeal available", "One appeal per request", false],
      ["Refund window ends", "Release becomes due", false],
      ["USDC to the business", "Anyone can trigger it", false],
    ] as Array<[string, string, boolean]>,
    outTitle: "Deny: objective policy violations",
    outBody: "Only when the policy clearly rules it out. The customer gets one appeal, and the money stays in escrow until the window ends.",
  },
  escalate: {
    name: "Escalate",
    dot: ACCENT,
    verdict: "ESCALATED",
    vBg: ACCENT,
    vFg: "#111111",
    chat: [
      ["Customer", "SSO is not working for our whole team since the update. Screenshot attached.", true, true],
      ["Refund assistant", `That is covered by ${DEMO.possessive} policy, but the amount is above what I may approve on my own, so I’ve sent ${DEMO.name} a summary. If they don’t answer by the deadline, it’s approved.`, false, false],
    ] as Msg[],
    route: [
      ["24.00 USDC in escrow", `Held while ${DEMO.name} decides`, true],
      [`Summary sent to ${DEMO.name}`, "With the chat and the attachment", true],
      ["Decision deadline", "No answer in time means approved", false],
      ["Refund or release", `Whatever ${DEMO.name} decides`, false],
    ] as Array<[string, string, boolean]>,
    outTitle: "Escalate: above your limits, or needs judgement",
    outBody: "The business gets a short summary. If they don’t respond by the decision deadline, the request is approved, so customers are never left waiting forever.",
  },
};
export function Refunds() {
  const sc = SCENARIOS.approve;
  const stagger = (i: number) => ({ animationDelay: `${i * 0.22}s` });
  return (
    <section id="refunds" className="z-band">
      <div className="z-wrap z-sec">
        <Head xl eyebrow="REFUNDS" lead="Customers open a refund flow from their receipt. The assistant asks follow-ups, checks your policy, and routes clear cases — inside your guardrails.">
          A refund button that <span className="z-acc">works.</span>
        </Head>

        <div className="z-grid" style={{ ["--min" as string]: "340px", alignItems: "stretch", gap: 24 }}>
          <div className="z-col" style={{ gap: 14, minWidth: 0 }}>
            <span className="z-eyebrow">ON THE RECEIPT PAGE</span>
            <div className="z-col" style={{ borderRadius: 28, background: "var(--z-bg)", border: "1.5px solid var(--z-edge)", overflow: "hidden" }}>
              <div className="z-col" style={{ gap: 2, padding: "18px 22px", borderBottom: "1.5px solid var(--z-hair)" }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>Refund request · Order #{DEMO_ORDER.id}</span>
                <span className="z-muted" style={{ fontSize: 13 }}>
                  {DEMO.name} · {DEMO_ORDER.productShort} · {DEMO_ORDER.usdc} in escrow
                </span>
              </div>
              <div className="z-col" style={{ padding: 22, gap: 12 }}>
                {sc.chat.map(([who, text, shopper, photo], i) => (
                  <div key={i} className="z-col z-msg" style={{ ...stagger(i), gap: 4, alignSelf: shopper ? "flex-end" : "flex-start", maxWidth: "86%" }}>
                    <span className="z-muted" style={{ fontSize: 12, fontWeight: 600, alignSelf: shopper ? "flex-end" : "flex-start" }}>
                      {who}
                    </span>
                    <div style={{ padding: "12px 16px", borderRadius: shopper ? "18px 18px 4px 18px" : "18px 18px 18px 4px", background: shopper ? "var(--z-btn)" : "var(--z-soft)", color: shopper ? "var(--z-btn-fg)" : "var(--z-fg)", fontSize: 15, lineHeight: 1.5 }}>{text}</div>
                    {photo ? (
                      <div aria-label="Attached photo" role="img" style={{ alignSelf: "flex-end", width: 150, height: 96, borderRadius: 14, border: "1.5px solid #111111", background: "#F4F4F1", position: "relative", overflow: "hidden" }}>
                        <div style={{ position: "absolute", left: 14, right: 14, top: 12, height: 62, borderRadius: 8, background: "#FFFFFF", border: "1.5px solid #111111", overflow: "hidden" }}>
                          <div style={{ height: 10, background: "#E6E6E1", borderBottom: "1px solid #111111" }} />
                          <div style={{ margin: "8px 8px 0", height: 14, borderRadius: 4, background: "#FDE2E2", border: "1px solid #DC2626" }} />
                          <div style={{ margin: "6px 8px 0", width: "60%", height: 6, borderRadius: 3, background: "#D9D9D4" }} />
                        </div>
                        <span className="z-mono" style={{ position: "absolute", left: 8, bottom: 6, fontSize: 10, fontWeight: 600, color: "#111111" }}>
                          SCREENSHOT.PNG
                        </span>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="z-col" style={{ gap: 16, minWidth: 0 }}>
            <div className="z-card" style={{ borderRadius: 22, gap: 12 }}>
              <span className="z-tag" style={{ alignSelf: "flex-start", background: sc.vBg, color: sc.vFg, fontSize: 12 }}>
                {sc.verdict}
              </span>
              <span className="z-display" style={{ fontSize: 24, letterSpacing: "-0.02em" }}>
                {sc.outTitle}
              </span>
              <span style={{ fontSize: 15, lineHeight: 1.55, color: "var(--z-body2)" }}>{sc.outBody}</span>
            </div>
            <div className="z-card ink" style={{ borderRadius: 28, gap: 20, flex: 1 }}>
              <span className="z-mono z-acc" style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em" }}>
                WHERE THE MONEY GOES
              </span>
              <ol className="z-col">
                {sc.route.map(([title, sub, on], i) => {
                  const next = sc.route[i + 1];
                  const last = i === sc.route.length - 1;
                  return (
                    <li key={title} style={{ display: "flex", gap: 14 }}>
                      <div className="z-col" style={{ alignItems: "center" }}>
                        <span style={{ width: 14, height: 14, borderRadius: 999, background: on ? ACCENT : "transparent", border: `2px solid ${on ? ACCENT : "#5A5A5A"}`, marginTop: 4, flex: "none" }} />
                        <span style={{ flex: 1, width: 2, minHeight: 22, background: last ? "transparent" : on && next?.[2] ? ACCENT : "#3A3A3A" }} />
                      </div>
                      <div className="z-col" style={{ gap: 2, paddingBottom: 16 }}>
                        <span className="z-display" style={{ fontSize: 19, fontWeight: 600 }}>
                          {title}
                        </span>
                        <span className="z-pm" style={{ fontSize: 14 }}>
                          {sub}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- seller protections + the contract ---------------- */

const TONE: Record<Tone, string> = { ok: "#3FE0A5", attention: ACCENT, neutral: "#6B6B6B", plain: "#FFFFFF" };

export function Protections() {
  const { href } = useApp();
  const [idx, setIdx] = useState<ProtectionIdx>(INITIAL_PROTECTIONS);
  const r = evaluate(idx);
  const controls: Array<{ key: keyof ProtectionIdx; name: string; help: string; value: string; less: string; more: string }> = [
    { key: "thr", name: "Guard threshold", help: "Above this, the AI can’t approve on its own.", value: `$${r.thr}`, less: "Lower guard threshold", more: "Raise guard threshold" },
    { key: "veto", name: "Veto window", help: "Time you get to overrule an AI approval.", value: `${r.veto}h`, less: "Shorter veto window", more: "Longer veto window" },
    { key: "cap", name: "Daily refund cap", help: "The most that can be refunded in a day.", value: `$${r.cap}`, less: "Lower daily cap", more: "Raise daily cap" },
    { key: "dl", name: "Decision deadline", help: "If you don’t decide by then, it’s approved.", value: `${r.dl}h`, less: "Shorter deadline", more: "Longer deadline" },
  ];
  const tagBg = r.overCap ? "#BDBDBD" : r.overThr ? ACCENT : "#3FE0A5";
  return (
    <section className="z-wrap z-sec">
      <Head eyebrow="BUSINESS PROTECTIONS" lead={`Guardrails apply to every refund — on chain, not just in the assistant. Adjust the controls to see how a $${REQUEST} request is handled.`}>
        The AI proposes. <span className="z-acc">Your rules</span> decide.
      </Head>
      <div className="z-grid">
        <div className="z-col" style={{ gap: 12 }}>
          {controls.map((c) => (
            <div key={c.key} style={{ borderRadius: 20, border: "1.5px solid var(--z-line)", padding: "18px 20px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
              <div className="z-col" style={{ gap: 3, flex: "1 1 200px" }}>
                <span style={{ fontWeight: 700, fontSize: 16 }}>{c.name}</span>
                <span className="z-muted" style={{ fontSize: 14, lineHeight: 1.45 }}>
                  {c.help}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button type="button" className="z-step" aria-label={c.less} onClick={() => setIdx((x) => nudge(x, c.key, -1))}>
                  −
                </button>
                <output className="z-mono" aria-label={c.name} style={{ minWidth: 86, textAlign: "center", fontSize: 18, fontWeight: 700 }}>
                  {c.value}
                </output>
                <button type="button" className="z-step" aria-label={c.more} onClick={() => setIdx((x) => nudge(x, c.key, 1))}>
                  +
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="z-card ink" style={{ borderRadius: 28, padding: 30, gap: 22 }} aria-live="polite">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div className="z-col" style={{ gap: 4 }}>
              <span className="z-mono z-pm" style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em" }}>
                INCOMING REQUEST
              </span>
              <span className="z-display" style={{ fontSize: 28, letterSpacing: "-0.02em" }}>
                ${REQUEST} · charged twice
              </span>
            </div>
            <span className="z-tag" style={{ fontSize: 12, padding: "7px 11px", background: tagBg, color: "#111111" }}>
              {r.tag}
            </span>
          </div>
          {r.evals.map((e, i) => (
            <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start", paddingTop: 16, borderTop: "1px solid var(--z-panel-line)" }}>
              <span className="z-mono" style={{ width: 26, height: 26, borderRadius: 999, background: TONE[e.tone], flex: "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: e.tone === "neutral" ? "#FFFFFF" : "#111111" }}>
                {i + 1}
              </span>
              <div className="z-col" style={{ gap: 3 }}>
                <span style={{ fontWeight: 600, fontSize: 16 }}>{e.title}</span>
                <span className="z-pm" style={{ fontSize: 14, lineHeight: 1.5 }}>
                  {e.body}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="z-muted" style={{ fontSize: 15, lineHeight: 1.55, margin: 0 }}>
        The same thresholds, caps, and deadlines are enforced in the escrow contract.{" "}
        <a href={href("/docs")} style={{ color: "inherit", fontWeight: 600 }}>
          Read how refunds work →
        </a>
      </p>
    </section>
  );
}

/* ---------------- verify: a real receipt ---------------- */

interface VerifyData {
  receipt: { id: string; merchantId: string; amount: string; released: string; refunded: string; status: string; kind: string; refundTarget: { chain: string; asset: string; address: string } };
  contract: string;
  networkId: string;
  mode: string;
  attribution: { matches: boolean; amountMatches: boolean; direct: boolean } | null;
  contractTotals: { allocated: string; usdcBalance: string; paused: boolean };
}

/** USDC minor units (6 dp) → "24.00". */
function usdc(minor: string): string {
  const n = BigInt(minor);
  const cents = (n + 5_000n) / 10_000n;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}
const short = (a: string) => (a.length > 18 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);
const STATUS: Record<string, string> = { Held: "in escrow", PartiallyReleased: "partly paid out", Released: "paid out to the business", PartiallyRefunded: "partly refunded", Refunded: "refunded" };

function useLatestReceipt() {
  const { href } = useApp();
  const [data, setData] = useState<VerifyData | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const get = <T,>(p: string) => fetch(href(p)).then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(new Error(String(r.status)))));
    get<{ id: string | null }>("/api/receipts/latest")
      .then((r) => (r.id ? get<VerifyData>(`/api/verify/${encodeURIComponent(r.id)}`) : null))
      .then((d) => live && setData(d))
      .catch(() => live && setData(null));
    return () => {
      live = false;
    };
  }, [href]);
  return data;
}

export function Verify() {
  const { href, host } = useApp();
  const [id, setId] = useState("");
  const data = useLatestReceipt();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = id.trim().replace(/^#/, "");
    if (clean) window.location.href = href(`/verify/${encodeURIComponent(clean)}`);
  };
  const shownHost = host ? host.replace(/^https?:\/\//, "") : "[YOUR-ZAP-HOST]";
  const facts = [
    ["Public escrow", "Funds sit in a NEAR contract anyone can read—not on a company balance.", true],
    ["Bounded refunds", "Daily caps, veto windows, and approval rules are enforced on chain.", false],
    ["You stay in control", "Pause new checkouts when you need to. Register the shop from your own NEAR account.", false],
  ] as const;

  const real = data ?? null;
  const rid = real?.receipt.id ?? DEMO_ORDER.id;
  const checks: Array<[string, string, boolean]> = real
    ? [
        ["Attribution", real.attribution ? `Paid to ${real.receipt.merchantId}${real.attribution.matches && real.attribution.amountMatches ? ", order and amount match" : ""}` : `Paid to ${real.receipt.merchantId}`, real.attribution ? real.attribution.matches && real.attribution.amountMatches : true],
        ["Refund destination", `Back to ${short(real.receipt.refundTarget.address)} on the ${real.receipt.refundTarget.chain.toUpperCase()} chain`, true],
        ["Solvency", `Contract holds ${usdc(real.contractTotals.usdcBalance)} USDC for ${usdc(real.contractTotals.allocated)} owed`, BigInt(real.contractTotals.usdcBalance) >= BigInt(real.contractTotals.allocated)],
      ]
    : [
        ["Attribution", "Payment attributed to your-business.near", true],
        ["Refund destination", "ETH · Ethereum · 0x8f3a…c21a", true],
        ["Solvency", "Contract USDC covers every open receipt", true],
      ];

  return (
    <section id="verify" className="z-rule">
      <div className="z-wrap z-sec" style={{ paddingBottom: 112 }}>
        <div className="z-title">
          <span className="z-eyebrow">VERIFY</span>
          <h2 className="z-h2 xl">
            Don&apos;t trust us. <span className="z-acc">Verify.</span>
          </h2>
          <p className="z-lead" style={{ maxWidth: 560 }}>
            Look up a receipt by number—no login. See attribution, refund routing, and whether escrow still covers the balance.
          </p>
          <form onSubmit={submit} className="z-row" style={{ gap: 10, maxWidth: 560, marginTop: 6 }}>
            <label htmlFor="z-verify-id" className="z-sr">
              Receipt number
            </label>
            <input id="z-verify-id" className="z-input" inputMode="numeric" autoComplete="off" placeholder={real ? `Receipt number, e.g. ${rid}` : "Receipt number"} value={id} onChange={(e) => setId(e.target.value)} />
            <button type="submit" className="z-btn ink" disabled={!id.trim()}>
              Verify
            </button>
          </form>
        </div>
        <div className="z-grid">
          <div className="z-col" style={{ borderRadius: 24, border: "1.5px solid var(--z-edge)", overflow: "hidden", background: "var(--z-bg)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", background: "var(--z-soft)", borderBottom: "1.5px solid var(--z-edge)" }}>
              <span className="z-dots" aria-hidden="true">
                <i style={{ background: "#B0B0AA" }} />
                <i style={{ background: "#B0B0AA" }} />
                <i style={{ background: "#B0B0AA" }} />
              </span>
              <span className="z-mono" style={{ flex: 1, minWidth: 0, height: 32, borderRadius: 8, background: "var(--z-bg)", display: "flex", alignItems: "center", padding: "0 12px", fontSize: 13, color: "var(--z-body)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                {shownHost}/verify/{rid}
              </span>
              {real ? (
                <span className="z-tag" style={{ background: "var(--z-good)", color: "#FFFFFF" }}>
                  LIVE · {real.networkId.toUpperCase()}
                </span>
              ) : null}
            </div>
            <div className="z-col" style={{ padding: 28, gap: 18 }}>
              {data === undefined ? (
                <>
                  <span className="z-skel" style={{ height: 30, width: "60%" }} />
                  <span className="z-skel" style={{ height: 64 }} />
                  <span className="z-skel" style={{ height: 64 }} />
                  <span className="z-skel" style={{ height: 64 }} />
                </>
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                    <span className="z-display" style={{ fontSize: 26, letterSpacing: "-0.02em" }}>
                      Receipt #{rid}
                    </span>
                    <span className="z-mono z-muted" style={{ fontSize: 13 }}>
                      {real ? `${usdc(real.receipt.amount)} USDC · ${STATUS[real.receipt.status] ?? real.receipt.status}` : `${DEMO_ORDER.usdc} · in escrow`}
                    </span>
                  </div>
                  {checks.map(([t, b, ok]) => (
                    <div key={t} style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: 16, borderRadius: 16, background: ok ? "var(--z-good-bg)" : "var(--z-soft)" }}>
                      <span style={{ width: 28, height: 28, borderRadius: 999, background: ok ? "var(--z-good)" : "#B45309", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                        {ok ? <Check /> : <Cross size={12} color="#FFFFFF" />}
                      </span>
                      <div className="z-col" style={{ gap: 3, minWidth: 0 }}>
                        <span style={{ fontWeight: 700, fontSize: 16 }}>{t}</span>
                        <span className="z-mono" style={{ fontSize: 13, color: "var(--z-body)", overflowWrap: "anywhere" }}>
                          {b}
                        </span>
                      </div>
                    </div>
                  ))}
                  {real ? (
                    <div className="z-row" style={{ gap: 10, justifyContent: "space-between" }}>
                      <span className="z-mono z-muted" style={{ fontSize: 12 }}>
                        Read just now from {real.contract}
                      </span>
                      <a className="z-btn sm ink" href={href(`/verify/${encodeURIComponent(rid)}`)}>
                        Open the full check
                      </a>
                    </div>
                  ) : (
                    <a className="z-btn sm" href={href("/verify")}>
                      Open verify
                    </a>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="z-col" style={{ gap: 12 }}>
            {facts.map(([title, body, ink]) => (
              <div key={title} className={`z-card ${ink ? "ink" : "soft"}`} style={{ borderRadius: 22, padding: 24, gap: 10 }}>
                <span className="z-display" style={{ fontSize: 22, letterSpacing: "-0.02em", lineHeight: 1.15 }}>
                  {title}
                </span>
                <span className={ink ? "z-pm" : undefined} style={{ fontSize: 14, lineHeight: 1.55, color: ink ? undefined : "var(--z-body2)" }}>
                  {body}
                </span>
              </div>
            ))}
            <a href={href("/docs")} className="z-muted" style={{ fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
              Verification &amp; contracts in the docs →
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
