"use client";

import { useState, type FormEvent } from "react";
import { useApp } from "./context";
import { Bolt, Check, Cross } from "./icons";
import { evaluate, INITIAL_PROTECTIONS, nudge, REQUEST, type ProtectionIdx, type Tone } from "./protections";

const ACCENT = "#FF2D87";

function Head({ eyebrow, children, lead, xl, center }: { eyebrow: string; children: React.ReactNode; lead?: React.ReactNode; xl?: boolean; center?: boolean }) {
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
export { Head };

export function Problem() {
  const bad = ["Bridge to our chain first", "Hold the one token we accept", "Paid means final. No refunds."];
  const good = ["Pay in whatever you already hold", "The seller always gets USDC", "Refunds go back to the original chain"];
  const line = { fontFamily: "var(--z-display)", fontSize: "clamp(19px, 2.2vw, 24px)", fontWeight: 600, letterSpacing: "-0.02em" } as const;
  return (
    <section className="z-wrap z-sec">
      <Head eyebrow="THE PROBLEM">
        Crypto checkout makes the shopper do the <span className="z-acc">work.</span>
      </Head>
      <div className="z-grid" style={{ ["--min" as string]: "320px" }}>
        <div className="z-card soft" style={{ borderRadius: 28, gap: 22 }}>
          <span className="z-eyebrow" style={{ letterSpacing: 0 }}>
            THE USUAL CRYPTO CHECKOUT
          </span>
          <ul className="z-col" style={{ gap: 22 }}>
            {bad.map((b) => (
              <li key={b} style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <span style={{ width: 36, height: 36, borderRadius: 999, border: "1.5px solid #8A8A8A", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  <Cross />
                </span>
                <span style={{ ...line, color: "#6B6B6B", textDecoration: "line-through", textDecorationThickness: 2 }}>{b}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="z-card ink" style={{ borderRadius: 28, gap: 22 }}>
          <span className="z-mono z-acc" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600 }}>
            <Bolt size={14} /> ZAP
          </span>
          <ul className="z-col" style={{ gap: 22 }}>
            {good.map((g) => (
              <li key={g} style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <span style={{ width: 36, height: 36, borderRadius: 999, background: ACCENT, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  <Check size={16} color="#111111" width={3} />
                </span>
                <span style={line}>{g}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

const COLORS = {
  ink: { name: "Ink", bg: "#111111", fg: "#FFFFFF", bolt: ACCENT },
  pink: { name: "Pink", bg: ACCENT, fg: "#111111", bolt: "#111111" },
  blue: { name: "Blue", bg: "#2F7BFF", fg: "#FFFFFF", bolt: "#FFFFFF" },
  white: { name: "White", bg: "#FFFFFF", fg: "#111111", bolt: ACCENT },
} as const;
const RADII = { square: ["Square", "6px"], rounded: ["Rounded", "14px"], pill: ["Pill", "999px"] } as const;
const LABELS = ["Pay with Zap", "Pay with crypto", "Checkout"];

export function DropIn() {
  const { host, merchant } = useApp();
  const [color, setColor] = useState<keyof typeof COLORS>("ink");
  const [radius, setRadius] = useState<keyof typeof RADII>("pill");
  const [label, setLabel] = useState(0);
  const col = COLORS[color];
  const shop = merchant || "your-shop.near";
  // The snippet mirrors the styler, so a seller can copy exactly what they see.
  const attrs: string[] = [`merchant="${shop}"`, `amount="24"`, `product="Pour-over kit"`, `color="${col.bg}"`];
  if (radius !== "rounded") attrs.push(`radius="${RADII[radius][1]}"`);
  if (label !== 0) attrs.push(`label="${LABELS[label]}"`);

  return (
    <section id="start" className="z-wrap z-sec" style={{ paddingTop: 32 }}>
      <Head eyebrow="DROP-IN" lead="A script tag and one element. The button opens a hosted checkout, so there's nothing to build and no keys on your site.">
        Paste it. You&apos;re taking <span className="z-acc">payments.</span>
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
            <span className="c-cm">{"// 3. react to the result (verify the signed webhook to fulfil)"}</span>
            {"\n"}
            button.<span className="c-at">addEventListener</span>(<span className="c-st">&apos;uc:paid&apos;</span>, showThanks)
          </pre>
        </div>
        <div className="z-card" style={{ gap: 22 }}>
          <div style={{ flex: 1, minHeight: 210, borderRadius: 18, background: "var(--z-soft)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 24 }}>
            <span style={{ fontSize: 14, color: "var(--z-muted)" }}>Pour-over kit · $24.00</span>
            <span aria-label={`Button preview: ${LABELS[label]}`} style={{ minHeight: 54, padding: "0 26px", borderRadius: RADII[radius][1], background: col.bg, color: col.fg, border: "1.5px solid #111111", fontWeight: 700, fontSize: 16, display: "inline-flex", alignItems: "center", gap: 9, transition: "all .25s ease" }}>
              <Bolt color={col.bolt} />
              {LABELS[label]}
            </span>
            <span className="z-mono" style={{ fontSize: 11, color: "#6B6B6B", textAlign: "center" }}>
              PREVIEW · SHADOW DOM, SO YOUR CSS STAYS YOURS
            </span>
          </div>
          <div className="z-col" style={{ gap: 14 }}>
            <div className="z-row" role="group" aria-label="Colour" style={{ gap: 10 }}>
              <span style={{ width: 70, fontSize: 13, fontWeight: 600 }}>Colour</span>
              {(Object.keys(COLORS) as Array<keyof typeof COLORS>).map((k) => (
                <button key={k} type="button" aria-pressed={color === k} aria-label={COLORS[k].name} onClick={() => setColor(k)} style={{ width: 44, height: 44, borderRadius: 999, border: `2px solid ${color === k ? "#111111" : "#E4E4E0"}`, padding: 4, background: "#FFFFFF" }}>
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
      <div className="z-row" style={{ gap: 10 }}>
        {["8.6 KB gzipped", "No dependencies", "Shadow DOM", "Themable", "uc:paid + uc:closed events", "Links and QR codes too"].map((s) => (
          <span key={s} className="z-chip">
            {s}
          </span>
        ))}
      </div>
    </section>
  );
}

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
        <span key={i} className="z-asset" aria-hidden={i >= items.length ? true : undefined}>
          <span className="z-coin" style={{ background: c }} />
          <span className="z-mono" style={{ fontSize: 15, fontWeight: 700 }}>
            {t}
          </span>
          <span style={{ fontSize: 14, color: "var(--z-muted)" }}>{n}</span>
        </span>
      ))}
    </div>
  );
}

export function AnyCoin() {
  const a = ASSETS.slice(0, 8);
  const b = ASSETS.slice(8);
  return (
    <section className="z-rule" style={{ paddingTop: 96, paddingBottom: 96, display: "flex", flexDirection: "column", gap: 44, overflow: "hidden" }}>
      <div className="z-wrap" style={{ width: "100%" }}>
        <Head eyebrow="ANY COIN" lead="NEAR Intents 1Click quotes an exact USDC output, so you always receive the amount you priced, delivered straight into the receipt contract.">
          ~230 assets in. <span className="z-acc">One</span> currency out.
        </Head>
      </div>
      <div className="z-col" style={{ gap: 10 }} role="img" aria-label="Example assets: Bitcoin, Ethereum, Solana, USDC, USDT, Arbitrum, Dogecoin, XRP, Zcash, BNB, NEAR, Polygon, TON, Sui">
        <Marquee items={a.concat(b)} />
        <Marquee items={b.concat(a)} reverse />
      </div>
      <div className="z-wrap z-col" style={{ width: "100%", gap: 14 }}>
        <div className="z-grid" style={{ ["--min" as string]: "280px", gap: 16 }}>
          <div className="z-card" style={{ borderRadius: 22, gap: 10, padding: 26 }}>
            <span className="z-eyebrow" style={{ fontSize: 12, letterSpacing: 0 }}>
              EVM CHAINS
            </span>
            <span className="z-display" style={{ fontSize: 26, letterSpacing: "-0.02em" }}>
              Pay with MetaMask
            </span>
            <span style={{ fontSize: 15, lineHeight: 1.55, color: "var(--z-body2)" }}>Connect, approve, done. The quote is already locked.</span>
          </div>
          <div className="z-card" style={{ borderRadius: 22, gap: 10, padding: 26 }}>
            <span className="z-eyebrow" style={{ fontSize: 12, letterSpacing: 0 }}>
              EVERY OTHER CHAIN
            </span>
            <span className="z-display" style={{ fontSize: 26, letterSpacing: "-0.02em" }}>
              Deposit address + QR
            </span>
            <span style={{ fontSize: 15, lineHeight: 1.55, color: "var(--z-body2)" }}>Send from any wallet or exchange. 1Click handles the swap.</span>
          </div>
          <div className="z-card ink" style={{ borderRadius: 22, gap: 10, padding: 26 }}>
            <span className="z-mono z-acc" style={{ fontSize: 12, fontWeight: 600 }}>
              ALREADY USDC ON NEAR
            </span>
            <span className="z-display" style={{ fontSize: 26, letterSpacing: "-0.02em" }}>
              Send it directly
            </span>
            <span style={{ fontSize: 15, lineHeight: 1.55, color: "#D4D4D4" }}>No swap at all. It goes straight into escrow.</span>
          </div>
        </div>
        <span style={{ fontSize: 13, color: "#6B6B6B" }}>Assets shown are examples. The live list comes from NEAR Intents.</span>
      </div>
    </section>
  );
}

type Msg = [who: string, text: string, shopper: boolean, photo: boolean];
const SCENARIOS = {
  approve: {
    name: "Approve",
    dot: "#1F9D57",
    verdict: "APPROVED",
    vBg: "#1F9D57",
    vFg: "#FFFFFF",
    chat: [
      ["Shopper", "The dripper arrived cracked. Photo attached.", true, true],
      ["Refund assistant", "Sorry about that. Is the crack on the dripper itself, or the packaging?", false, false],
      ["Shopper", "The dripper. It leaks.", true, false],
      ["Refund assistant", "The order shows delivered and your shop’s policy covers damage on arrival. Approved: 24.00 USDC goes back to you as ETH.", false, false],
    ] as Msg[],
    route: [
      ["24.00 USDC in escrow", "Held by receipt NFT #1042", true],
      ["Seller veto window", "The seller can still step in", true],
      ["1Click swap back", "Quote ID logged on chain", true],
      ["ETH on Ethereum", "To 0x8f3a…c21a, the refund address", true],
    ] as Array<[string, string, boolean]>,
    outTitle: "Approve: clear, small cases",
    outBody: "The assistant approves within your guard threshold. AI approvals still wait out your veto window before the refund executes.",
  },
  deny: {
    name: "Deny",
    dot: "#6B6B6B",
    verdict: "DENIED · 1 APPEAL",
    vBg: "#111111",
    vFg: "#FFFFFF",
    chat: [
      ["Shopper", "I changed my mind. Can I get a refund?", true, false],
      ["Refund assistant", "Was anything wrong with the item, or did it arrive late?", false, false],
      ["Shopper", "No, it’s fine. I just don’t need it.", true, false],
      ["Refund assistant", "This shop’s policy covers damage and non-delivery, not change of mind, so I can’t approve this. You can appeal once.", false, false],
    ] as Msg[],
    route: [
      ["24.00 USDC in escrow", "Nothing moves", true],
      ["Appeal available", "One appeal per request", false],
      ["Refund window ends", "Release becomes due", false],
      ["USDC to the seller", "Anyone can trigger it", false],
    ] as Array<[string, string, boolean]>,
    outTitle: "Deny: objective policy violations",
    outBody: "Only when the policy clearly rules it out. The shopper gets one appeal, and the money stays in escrow until the window ends.",
  },
  escalate: {
    name: "Escalate",
    dot: ACCENT,
    verdict: "ESCALATED",
    vBg: ACCENT,
    vFg: "#111111",
    chat: [
      ["Shopper", "It works, but the colour isn’t what the photos showed.", true, true],
      ["Refund assistant", "Thanks. Is it a different product, or a different shade of the same one?", false, false],
      ["Shopper", "Same product, much darker.", true, false],
      ["Refund assistant", "This needs the seller’s judgement. I’ve sent them a summary of our chat. They’ll decide before the deadline.", false, false],
    ] as Msg[],
    route: [
      ["24.00 USDC in escrow", "Held while the seller decides", true],
      ["Summary sent to seller", "With the chat and the attachment", true],
      ["Decision deadline", "No answer in time means approved", false],
      ["Refund or release", "Whatever the seller decides", false],
    ] as Array<[string, string, boolean]>,
    outTitle: "Escalate: anything that needs judgement",
    outBody: "The seller gets a short summary. If they don’t respond by the decision deadline, the request is approved, so shoppers are never left waiting forever.",
  },
};
type ScenKey = keyof typeof SCENARIOS;

export function Refunds() {
  const [scen, setScen] = useState<ScenKey>("approve");
  const sc = SCENARIOS[scen];
  return (
    <section id="refunds" className="z-band">
      <div className="z-wrap z-sec">
        <Head xl eyebrow="REFUNDS" lead="A refund assistant handles the first response. It can ask up to three questions, ask for a photo, and check your policy and the order's fulfilment status.">
          Crypto payments with a real <span className="z-acc">refund button.</span>
        </Head>
        <div role="tablist" aria-label="Refund outcome" className="z-row" style={{ gap: 8 }}>
          {(Object.keys(SCENARIOS) as ScenKey[]).map((k) => (
            <button key={k} type="button" role="tab" id={`z-tab-${k}`} aria-controls="z-refund-panel" aria-selected={scen === k} className="z-btn" style={{ minHeight: 48, padding: "0 22px", fontSize: 15 }} onClick={() => setScen(k)}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: SCENARIOS[k].dot }} />
              {SCENARIOS[k].name}
            </button>
          ))}
        </div>
        <div id="z-refund-panel" role="tabpanel" aria-labelledby={`z-tab-${scen}`} className="z-grid" style={{ alignItems: "stretch" }}>
          <div className="z-col" style={{ borderRadius: 28, background: "#FFFFFF", border: "1.5px solid #111111", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "18px 22px", borderBottom: "1.5px solid var(--z-hair)" }}>
              <div className="z-col" style={{ gap: 2, minWidth: 0 }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>Refund request · Order #1042</span>
                <span style={{ fontSize: 13, color: "var(--z-muted)" }}>Kettle &amp; Co. · Pour-over kit · 24.00 USDC in escrow</span>
              </div>
              <span className="z-tag" style={{ background: sc.vBg, color: sc.vFg }}>
                {sc.verdict}
              </span>
            </div>
            <div className="z-col" style={{ padding: 22, gap: 12, flex: 1 }}>
              {sc.chat.map(([who, text, shopper, photo], i) => (
                <div key={`${scen}-${i}`} className="z-col" style={{ gap: 4, alignSelf: shopper ? "flex-end" : "flex-start", maxWidth: "86%" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#6B6B6B", alignSelf: shopper ? "flex-end" : "flex-start" }}>{who}</span>
                  <div style={{ padding: "12px 16px", borderRadius: shopper ? "18px 18px 4px 18px" : "18px 18px 18px 4px", background: shopper ? "#111111" : "var(--z-soft)", color: shopper ? "#FFFFFF" : "#111111", fontSize: 15, lineHeight: 1.5 }}>{text}</div>
                  {photo ? (
                    <div aria-label="Attached photo" role="img" style={{ alignSelf: "flex-end", width: 150, height: 96, borderRadius: 14, border: "1.5px solid #111111", background: "var(--z-soft)", position: "relative", overflow: "hidden" }}>
                      <div style={{ position: "absolute", left: 34, top: 22, width: 80, height: 54, borderRadius: "0 0 40px 40px", background: "#FFFFFF", border: "1.5px solid #111111" }} />
                      <div style={{ position: "absolute", left: 70, top: 30, width: 2, height: 40, background: "#111111", transform: "rotate(18deg)" }} />
                      <span className="z-mono" style={{ position: "absolute", left: 8, bottom: 6, fontSize: 10, fontWeight: 600 }}>
                        PHOTO.JPG
                      </span>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
          <div className="z-col" style={{ gap: 16 }}>
            <div className="z-card ink" style={{ borderRadius: 28, gap: 20 }}>
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
                        <span style={{ width: 14, height: 14, borderRadius: 999, background: on ? ACCENT : "#111111", border: `2px solid ${on ? ACCENT : "#5A5A5A"}`, marginTop: 4, flex: "none" }} />
                        <span style={{ flex: 1, width: 2, minHeight: 22, background: last ? "transparent" : on && next?.[2] ? ACCENT : "#3A3A3A" }} />
                      </div>
                      <div className="z-col" style={{ gap: 2, paddingBottom: 16 }}>
                        <span className="z-display" style={{ fontSize: 19, fontWeight: 600 }}>
                          {title}
                        </span>
                        <span style={{ fontSize: 14, color: "#BDBDBD" }}>{sub}</span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
            <div className="z-card" style={{ borderRadius: 22, gap: 8, padding: "22px 24px" }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>{sc.outTitle}</span>
              <span style={{ fontSize: 15, lineHeight: 1.55, color: "var(--z-body2)" }}>{sc.outBody}</span>
            </div>
            <div className="z-row" style={{ gap: 8 }}>
              {["NEAR AI Cloud", "or a deterministic rule engine", "≤ 3 clarifying questions", "asks for a photo"].map((c) => (
                <span key={c} className="z-chip sm">
                  {c}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const TONE: Record<Tone, string> = { ok: "#3FE0A5", attention: ACCENT, neutral: "#6B6B6B", plain: "#FFFFFF" };

export function Protections() {
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
      <Head eyebrow="SELLER PROTECTIONS" lead={`Limits are enforced in code and on chain, not just in a prompt. Try the controls and watch what happens to a $${REQUEST} refund request.`}>
        The AI proposes. <span className="z-acc">Your rules</span> decide.
      </Head>
      <div className="z-grid">
        <div className="z-col" style={{ gap: 12 }}>
          {controls.map((c) => (
            <div key={c.key} style={{ borderRadius: 20, border: "1.5px solid var(--z-line)", padding: "18px 20px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
              <div className="z-col" style={{ gap: 3, flex: "1 1 200px" }}>
                <span style={{ fontWeight: 700, fontSize: 16 }}>{c.name}</span>
                <span style={{ fontSize: 14, color: "var(--z-muted)", lineHeight: 1.45 }}>{c.help}</span>
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
              <span className="z-mono" style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", color: "#BDBDBD" }}>
                INCOMING REQUEST
              </span>
              <span className="z-display" style={{ fontSize: 28, letterSpacing: "-0.02em" }}>
                ${REQUEST} · arrived damaged
              </span>
            </div>
            <span className="z-tag" style={{ fontSize: 12, padding: "7px 11px", background: tagBg, color: "#111111" }}>
              {r.tag}
            </span>
          </div>
          {r.evals.map((e, i) => (
            <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start", paddingTop: 16, borderTop: "1px solid #2A2A2A" }}>
              <span className="z-mono" style={{ width: 26, height: 26, borderRadius: 999, background: TONE[e.tone], flex: "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: e.tone === "neutral" ? "#FFFFFF" : "#111111" }}>
                {i + 1}
              </span>
              <div className="z-col" style={{ gap: 3 }}>
                <span style={{ fontWeight: 600, fontSize: 16 }}>{e.title}</span>
                <span style={{ fontSize: 14, color: "#BDBDBD", lineHeight: 1.5 }}>{e.body}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Verify() {
  const { href, host } = useApp();
  const [id, setId] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = id.trim().replace(/^#/, "");
    if (clean) window.location.href = href(`/verify/${encodeURIComponent(clean)}`);
  };
  const shownHost = host ? host.replace(/^https?:\/\//, "") : "[YOUR-ZAP-HOST]";
  const checks = [
    ["Attribution", "Payment attributed to kettleandco.near"],
    ["Refund destination", "ETH · Ethereum · 0x8f3a…c21a"],
    ["Solvency", "Contract USDC covers every open receipt"],
  ];
  const facts = [
    ["01", "Public contract, not a company", "Escrow lives in a NEAR contract anyone can read.", true],
    ["02", "Refunds are bounded", "Only approved requests, never more than the unreleased amount, always within the daily cap.", false],
    ["03", "Refunds survive a pause", "Pausing stops new payments and releases. Refunds keep working.", false],
    ["04", "Sellers can take over", "Call register_merchant from your own account to own your registration.", false],
  ] as const;
  return (
    <section id="verify" className="z-rule">
      <div className="z-wrap z-sec" style={{ paddingBottom: 112 }}>
        <div className="z-title">
          <span className="z-eyebrow">VERIFY</span>
          <h2 className="z-h2 xl">
            Don&apos;t trust us. <span className="z-acc">Verify.</span>
          </h2>
          <p className="z-lead" style={{ maxWidth: 560 }}>
            Funds sit in a public NEAR contract, not with a company. Anyone can open /verify and check a receipt for themselves.
          </p>
          <form onSubmit={submit} className="z-row" style={{ gap: 10, maxWidth: 560, marginTop: 6 }}>
            <label htmlFor="z-verify-id" className="z-sr">
              Receipt number
            </label>
            <input id="z-verify-id" className="z-input" inputMode="numeric" autoComplete="off" placeholder="Receipt number, e.g. 12" value={id} onChange={(e) => setId(e.target.value)} />
            <button type="submit" className="z-btn ink" disabled={!id.trim()}>
              Verify
            </button>
          </form>
        </div>
        <div className="z-grid">
          <div className="z-col" style={{ borderRadius: 24, border: "1.5px solid #111111", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", background: "var(--z-soft)", borderBottom: "1.5px solid #111111" }}>
              <span className="z-dots" aria-hidden="true">
                <i style={{ background: "#D0D0CA" }} />
                <i style={{ background: "#D0D0CA" }} />
                <i style={{ background: "#D0D0CA" }} />
              </span>
              <span className="z-mono" style={{ flex: 1, minWidth: 0, height: 32, borderRadius: 8, background: "#FFFFFF", display: "flex", alignItems: "center", padding: "0 12px", fontSize: 13, color: "var(--z-body)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                {shownHost}/verify/1042
              </span>
            </div>
            <div className="z-col" style={{ padding: 28, gap: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                <span className="z-display" style={{ fontSize: 26, letterSpacing: "-0.02em" }}>
                  Receipt #1042
                </span>
                <span className="z-mono" style={{ fontSize: 13, color: "var(--z-muted)" }}>
                  24.00 USDC · in escrow
                </span>
              </div>
              {checks.map(([t, b]) => (
                <div key={t} style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: 16, borderRadius: 16, background: "#F3FBF6" }}>
                  <span style={{ width: 28, height: 28, borderRadius: 999, background: "var(--z-good)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                    <Check />
                  </span>
                  <div className="z-col" style={{ gap: 3, minWidth: 0 }}>
                    <span style={{ fontWeight: 700, fontSize: 16 }}>{t}</span>
                    <span className="z-mono" style={{ fontSize: 13, color: "var(--z-body)", overflowWrap: "anywhere" }}>
                      {b}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="z-grid" style={{ ["--min" as string]: "200px", gap: 16 }}>
            {facts.map(([n, title, body, ink]) => (
              <div key={n} className={`z-card ${ink ? "ink" : "soft"}`} style={{ borderRadius: 22, padding: 24, gap: 10 }}>
                <span className="z-mono" style={{ fontSize: 12, fontWeight: 700, color: ink ? ACCENT : "var(--z-muted)" }}>
                  {n}
                </span>
                <span className="z-display" style={{ fontSize: 22, letterSpacing: "-0.02em", lineHeight: 1.15 }}>
                  {title}
                </span>
                <span style={{ fontSize: 14, lineHeight: 1.55, color: ink ? "#D4D4D4" : "var(--z-body2)" }}>{body}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
