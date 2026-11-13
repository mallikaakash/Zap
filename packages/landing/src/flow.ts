/**
 * The hero's payment/refund walkthrough as pure data: a step machine, per-step
 * dwell times, scrub targets and the isometric projection that places the coin,
 * pins and receipt card. Kept free of React so it can be unit-tested.
 *
 * The phone is the shopper's wallet: the coin is born on its Pay button, crosses
 * the bridge (NEAR Intents), lands in the safe (receipt contract) and finally
 * reaches the shop. The camera looks so that the path rises to the right.
 */

export type CoinKey = "ETH" | "SOL" | "BTC" | "USDT";
export type Actor = "button" | "wallet" | "bridge" | "worker" | "vault" | "shop" | "asst";
/** "phone" is resolved by the caller (it is measured from the DOM). */
export type Waypoint = "phone" | "bs" | "be" | "vault" | "stack";

export interface Coin {
  label: string;
  chain: string;
  color: string;
  how: "MetaMask" | "deposit address";
  addr: string;
}

export const COINS: Record<CoinKey, Coin> = {
  ETH: { color: "#9AA0FF", chain: "Ethereum", label: "ETH", how: "MetaMask", addr: "0x8f3a…c21a" },
  SOL: { color: "#3FE0A5", chain: "Solana", label: "SOL", how: "deposit address", addr: "7xKp…9fQe" },
  BTC: { color: "#FFB23F", chain: "Bitcoin", label: "BTC", how: "deposit address", addr: "bc1q…h7lw" },
  USDT: { color: "#48C9A0", chain: "Polygon", label: "USDT", how: "MetaMask", addr: "0x8f3a…c21a" },
};
export const COIN_KEYS = Object.keys(COINS) as CoinKey[];
export const USDC_COLOR = "#2F7BFF";

export interface FlowState {
  step: number;
  mode: "pay" | "refund";
  coin: CoinKey;
  /** Completed loops. Odd loops branch into the refund story at step 8. */
  run: number;
  paused: boolean;
}

export const INITIAL_FLOW: FlowState = { step: 0, mode: "pay", coin: "ETH", run: 0, paused: false };

export interface Step {
  wp: Waypoint;
  vis: boolean;
  usdc?: boolean;
  act: Actor;
  nft?: boolean;
  win?: boolean;
  cap: string;
  /** Milliseconds to stay on this step before advancing. */
  ms: number;
}

export function sequence(mode: FlowState["mode"], coinKey: CoinKey): Step[] {
  const coin = COINS[coinKey];
  const dep =
    coin.how === "MetaMask"
      ? `Tap. They pay ${coin.label} from MetaMask on ${coin.chain}.`
      : `Tap. They send ${coin.label} to a one-time deposit address on ${coin.chain}.`;
  const pay: Step[] = [
    { wp: "phone", vis: false, act: "button", ms: 3200, cap: "A shopper hits the Zap pay button on any site." },
    { wp: "phone", vis: false, act: "button", ms: 3400, cap: `The hosted checkout opens. They pick ${coin.label} on ${coin.chain} and leave a refund address.` },
    { wp: "phone", vis: true, act: "wallet", ms: 2600, cap: dep },
    { wp: "bs", vis: true, act: "bridge", ms: 2400, cap: `NEAR Intents 1Click quotes an exact USDC output for their ${coin.label}.` },
    { wp: "be", vis: true, usdc: true, act: "bridge", ms: 2400, cap: "Swapped. The USDC is delivered straight to the receipt contract." },
    { wp: "vault", vis: true, usdc: true, act: "worker", ms: 2400, cap: "The settlement worker sees it land and calls mint_receipt." },
    { wp: "vault", vis: true, usdc: true, act: "vault", nft: true, ms: 2600, cap: "A receipt NFT is minted. The USDC is held inside it, in escrow." },
    // The held breath: the whole product is this pause.
    { wp: "vault", vis: true, usdc: true, act: "vault", nft: true, win: true, ms: 5200, cap: "The refund window is open. Funds sit in a public contract, not with a company." },
    { wp: "stack", vis: true, usdc: true, act: "shop", ms: 2800, cap: "Window closed. Anyone can trigger the release, and USDC goes to the seller." },
    { wp: "stack", vis: false, usdc: true, act: "shop", ms: 3600, cap: `Settled in USDC, though the shopper paid in ${coin.label}.` },
  ];
  if (mode === "pay") return pay;
  return pay.slice(0, 8).concat([
    { wp: "vault", vis: true, usdc: true, act: "asst", nft: true, win: true, ms: 3000, cap: "Refund requested. The assistant checks the policy and fulfilment status." },
    { wp: "vault", vis: true, usdc: true, act: "worker", nft: true, ms: 2600, cap: "Within the seller’s caps and veto window, the worker executes the refund." },
    { wp: "be", vis: true, usdc: true, act: "bridge", ms: 2400, cap: "Back through 1Click. The quote ID is logged on chain." },
    { wp: "bs", vis: true, act: "bridge", ms: 2400, cap: `Converted back to ${coin.label}.` },
    { wp: "phone", vis: true, act: "wallet", ms: 3800, cap: `Refunded in ${coin.label} on ${coin.chain}, to the refund address.` },
  ]);
}

/** How long the current step is shown. */
export function dwell(s: FlowState): number {
  const seq = sequence(s.mode, s.coin);
  return seq[Math.min(s.step, seq.length - 1)]!.ms;
}

/** One timer tick. Every other loop tells the refund story. */
export function advance(s: FlowState): FlowState {
  if (s.paused) return s;
  const last = sequence(s.mode, s.coin).length - 1;
  if (s.mode === "pay" && s.step === 7 && s.run % 2 === 1) return { ...s, mode: "refund", step: 8 };
  if (s.step >= last) return { ...s, step: 0, mode: "pay", run: s.run + 1 };
  return { ...s, step: s.step + 1 };
}

/** Jump the story to where an actor first does its work (legend scrubber). Pauses playback. */
export function scrubTo(s: FlowState, actor: Actor): FlowState {
  if (actor === "asst") return { ...s, mode: "refund", step: 8, run: 1, paused: true };
  const i = sequence("pay", s.coin).findIndex((st) => st.act === actor);
  return { ...s, mode: "pay", step: Math.max(0, i), run: 0, paused: true };
}

/**
 * Isometric projection matching the scene's rotateX(-30deg) rotateY(45deg):
 * +x runs up and to the right, +z comes towards the viewer and down to the right.
 */
export function proj(x: number, y: number, z: number): [number, number] {
  return [0.7071 * (x + z), 0.866 * y + 0.3536 * (z - x)];
}

export type Pt = [number, number];
const pts = (arr: Pt[]) => arr.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");

/** World positions of the scene's objects (x along the route). */
export const PLACES = {
  bridge: { x: -310, z: 0, k: 1 },
  worker: { x: -208, z: 180, k: 0.95 },
  vault: { x: 140, z: 0, k: 0.92 },
  asst: { x: 154, z: 200, k: 0.9 },
  shop: { x: 520, z: 0, k: 0.84 },
  stack: { x: 470, z: 120, k: 0.84 },
} as const;

export interface Disc {
  y: number;
  c: string;
  t: string;
}
export interface Pin {
  n: string;
  label: string;
  x: number;
  y: number;
  on: boolean;
}

/** Scene-space (projected, origin = scene origin) position of a non-phone waypoint. */
export function sceneWaypoint(wp: Exclude<Waypoint, "phone">, usdcCount: number): Pt {
  switch (wp) {
    case "bs":
      return proj(PLACES.bridge.x - 140, -72, 0);
    case "be":
      return proj(PLACES.bridge.x + 140, -72, 0);
    case "vault":
      return proj(PLACES.vault.x, -126 * PLACES.vault.k, 0);
    case "stack":
      return proj(PLACES.stack.x, (-usdcCount * 9 - 6) * PLACES.stack.k, PLACES.stack.z);
  }
}

/** Everything the scene needs for the current frame, in scene space. */
export function flowView(s: FlowState) {
  const coin = COINS[s.coin];
  const isRefund = s.mode === "refund";
  const seq = sequence(s.mode, s.coin);
  const step = Math.min(s.step, seq.length - 1);
  const cur = seq[step]!;
  const active = (id: Actor) => cur.act === id;
  const L = (id: Actor) => (active(id) && step > 1 ? -12 : 0);

  const usdcCount = 2 + (!isRefund && step >= 9 ? 1 : 0);
  const usdcDiscs: Disc[] = [];
  for (let i = 0; i < usdcCount; i++) {
    usdcDiscs.push({ y: -i * 9 - 1, c: "#1D5BD0", t: "" });
    usdcDiscs.push({ y: -i * 9 - 6, c: USDC_COLOR, t: i === usdcCount - 1 ? "USDC" : "" });
  }

  const pin = (n: string, label: string, id: Actor, x: number, y: number, z: number): Pin => {
    const p = proj(x, y, z);
    return { n, label, x: p[0], y: p[1] + L(id) * 0.866, on: active(id) && step > 1 };
  };
  const nftAnchor = proj(PLACES.vault.x + 10, -126, -60);

  const refundProg = isRefund && step >= 8 && step <= 11;
  const payProg = step >= 2 && step <= 5;
  const progress = refundProg
    ? {
        rows: [
          ["Assistant review", "Policy and fulfilment checked"],
          ["Seller protections", "Caps and veto window respected"],
          ["Refund sent", "Swapped back via 1Click"],
        ] as Array<[string, string]>,
        at: step === 8 ? 0 : step === 9 ? 1 : 2,
      }
    : {
        rows: [
          ["Deposit sent", coin.how === "MetaMask" ? "From MetaMask" : "To a deposit address"],
          ["Swapping to USDC", "NEAR Intents · 1Click"],
          ["Minting your receipt", "mint_receipt on NEAR"],
        ] as Array<[string, string]>,
        at: step === 2 ? 0 : step <= 4 ? 1 : 2,
      };

  const bridgeStart = sceneWaypoint("bs", usdcCount);
  return {
    coin,
    isRefund,
    step,
    total: seq.length,
    cur,
    active,
    lf: { bridge: L("bridge"), worker: L("worker"), vault: L("vault"), asst: L("asst"), shop: L("shop") },
    usdcCount,
    usdcDiscs,
    bridgeStart,
    /** Route after the bridge: bridge → safe → shop → off the right edge. */
    route: pts([bridgeStart, sceneWaypoint("be", usdcCount), proj(PLACES.vault.x, -60, 0), proj(PLACES.stack.x, -20, PLACES.stack.z), proj(PLACES.shop.x, -30, 0), proj(1300, -30, 0)]),
    branch: pts([proj(PLACES.vault.x, -40, 50), proj(PLACES.asst.x, -50, PLACES.asst.z - 30)]),
    branchOn: isRefund && step >= 8,
    nft: { x: nftAnchor[0] + 24, y: nftAnchor[1] - 40 + L("vault") * 0.866, on: !!cur.nft },
    nftState: isRefund && step >= 8 ? "Refund in review" : "In escrow · refund window open",
    windowPct: cur.win ? "62%" : cur.nft ? "8%" : "0%",
    pins: [
      pin("03", "NEAR Intents", "bridge", PLACES.bridge.x, -175, 0),
      pin("04", "Settlement worker", "worker", PLACES.worker.x, -150, PLACES.worker.z),
      pin("05", "Receipt contract", "vault", PLACES.vault.x - 150, -40, 30),
      pin("R", "Refund assistant", "asst", PLACES.asst.x, -130, PLACES.asst.z),
      pin("06", "Seller payout", "shop", PLACES.shop.x, -150, 0),
    ],
    puck: {
      wp: cur.wp,
      on: cur.vis,
      usdc: !!cur.usdc,
      color: cur.usdc ? USDC_COLOR : coin.color,
      fg: cur.usdc ? "#FFFFFF" : "#111111",
      text: cur.usdc ? "USDC" : coin.label,
      tag: cur.usdc ? "24.00 USDC" : `$24 in ${coin.label}`,
      lift: (({ bs: "bridge", be: "bridge", vault: "vault", stack: "shop", phone: "wallet" }) as const)[cur.wp],
    },
    /** The tap: the coin is born on the Pay button. */
    tapped: !isRefund && step === 2,
    landed: step === 5,
    minted: step === 6,
    screen: (step === 0
      ? "shop"
      : step === 1
        ? "sheet"
        : payProg || refundProg
          ? "progress"
          : step >= 6 && step <= 7
            ? "receipt"
            : "final") as "shop" | "sheet" | "progress" | "receipt" | "final",
    progress,
    refundProg,
    stepNo: `${String(step + 1).padStart(2, "0")} / ${String(seq.length).padStart(2, "0")}`,
    refundStory: isRefund || s.run % 2 === 1,
  };
}

export const LEGEND: Array<[string, Actor, string, string]> = [
  ["01", "button", "Pay button", "<pay-button> on any page opens a hosted checkout. Pick a coin, add a refund address."],
  ["02", "wallet", "Deposit", "MetaMask on EVM chains, or a deposit address and QR code for everything else."],
  ["03", "bridge", "NEAR Intents · 1Click", "Swaps to an exact USDC amount, sent straight to the receipt contract."],
  ["04", "worker", "Settlement worker", "Sees the USDC land and calls mint_receipt. Later it runs approved refunds."],
  ["05", "vault", "Receipt contract", "A NEP-171 receipt NFT holds the USDC in escrow until the window closes."],
  ["06", "shop", "Seller payout", "When the window ends, anyone can trigger the release. USDC goes to the seller."],
  ["R", "asst", "Refund assistant", "Approves clear cases, denies violations or escalates, inside the seller’s caps, veto window and deadline."],
];
