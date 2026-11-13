/**
 * The hero's payment/refund walkthrough as pure data: a step machine plus the
 * isometric projection used to place the moving coin, pins and receipt card.
 * Kept free of React so it can be unit-tested.
 */

export type CoinKey = "ETH" | "SOL" | "BTC" | "USDT";
export type Actor = "button" | "wallet" | "bridge" | "worker" | "vault" | "shop" | "asst";
type Waypoint = "wallet" | "bs" | "be" | "vault" | "stack";

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
  /** Ticks spent resting on the first/last frame. */
  hold: number;
}

export const INITIAL_FLOW: FlowState = { step: 0, mode: "pay", coin: "ETH", run: 0, paused: false, hold: 0 };

export interface Step {
  wp: Waypoint;
  vis: boolean;
  usdc?: boolean;
  act: Actor;
  nft?: boolean;
  win?: boolean;
  cap: string;
}

export function sequence(mode: FlowState["mode"], coinKey: CoinKey): Step[] {
  const coin = COINS[coinKey];
  const dep =
    coin.how === "MetaMask"
      ? `They pay ${coin.label} from MetaMask on ${coin.chain}.`
      : `They send ${coin.label} to a one-time deposit address on ${coin.chain}.`;
  const pay: Step[] = [
    { wp: "wallet", vis: false, act: "button", cap: "A shopper hits the Zap pay button on any site." },
    { wp: "wallet", vis: false, act: "button", cap: "The hosted checkout opens. They pick any coin and leave a refund address." },
    { wp: "wallet", vis: true, act: "wallet", cap: dep },
    { wp: "bs", vis: true, act: "bridge", cap: "NEAR Intents 1Click quotes an exact USDC output." },
    { wp: "be", vis: true, usdc: true, act: "bridge", cap: "Swapped. The USDC is delivered straight to the receipt contract." },
    { wp: "vault", vis: true, usdc: true, act: "worker", cap: "The settlement worker sees it land and calls mint_receipt." },
    { wp: "vault", vis: true, usdc: true, act: "vault", nft: true, cap: "A receipt NFT is minted. The USDC is held inside it, in escrow." },
    { wp: "vault", vis: true, usdc: true, act: "vault", nft: true, win: true, cap: "The refund window is open. Funds sit in a public contract, not with a company." },
    { wp: "stack", vis: true, usdc: true, act: "shop", cap: "Window closed. Anyone can trigger the release, and USDC goes to the seller." },
    { wp: "stack", vis: false, usdc: true, act: "shop", cap: "Settled in USDC, whatever the shopper paid with." },
  ];
  if (mode === "pay") return pay;
  return pay.slice(0, 8).concat([
    { wp: "vault", vis: true, usdc: true, act: "asst", nft: true, win: true, cap: "Refund requested. The assistant checks the policy and fulfilment status." },
    { wp: "vault", vis: true, usdc: true, act: "worker", nft: true, cap: "Within the seller’s caps and veto window, the worker executes the refund." },
    { wp: "be", vis: true, usdc: true, act: "bridge", cap: "Back through 1Click. The quote ID is logged on chain." },
    { wp: "bs", vis: true, act: "bridge", cap: `Converted back to ${coin.label}.` },
    { wp: "wallet", vis: true, act: "wallet", cap: `Refunded in ${coin.label} on ${coin.chain}, to the refund address.` },
  ]);
}

/** One timer tick. First and last frames rest for an extra tick; every other loop tells the refund story. */
export function advance(s: FlowState): FlowState {
  if (s.paused) return s;
  const last = sequence(s.mode, s.coin).length - 1;
  if ((s.step === 0 || s.step === last) && s.hold < 1) return { ...s, hold: s.hold + 1 };
  if (s.mode === "pay" && s.step === 7 && s.run % 2 === 1) return { ...s, mode: "refund", step: 8, hold: 0 };
  if (s.step >= last) return { ...s, step: 0, mode: "pay", run: s.run + 1, hold: 0 };
  return { ...s, step: s.step + 1, hold: 0 };
}

/** Isometric projection matching the scene's rotateX(-30deg) rotateY(-45deg). */
export function proj(x: number, y: number, z: number): [number, number] {
  return [0.7071 * (x - z), 0.866 * y + 0.3536 * (x + z)];
}

const pts = (arr: Array<[number, number]>) => arr.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");

export interface Disc {
  y: number;
  c: string;
  t: string;
}
export interface Pin {
  n: string;
  x: string;
  y: string;
  on: boolean;
}

/** Everything the scene needs for the current frame. */
export function flowView(s: FlowState) {
  const coin = COINS[s.coin];
  const isRefund = s.mode === "refund";
  const seq = sequence(s.mode, s.coin);
  const step = Math.min(s.step, seq.length - 1);
  const cur = seq[step]!;
  const active = (id: Actor) => cur.act === id;
  const L = (id: Actor) => (active(id) && step > 1 ? -12 : 0);
  const lift = (id: Actor) => L(id) * 0.866;

  const usdcCount = 2 + (!isRefund && step >= 9 ? 1 : 0);
  const walletDiscs: Disc[] = [];
  for (let i = 0; i < 4; i++) {
    const y = -48 - i * 9;
    walletDiscs.push({ y, c: `color-mix(in srgb, ${coin.color} 70%, #111111)`, t: "" });
    walletDiscs.push({ y: y - 5, c: coin.color, t: i === 3 ? coin.label : "" });
  }
  const usdcDiscs: Disc[] = [];
  for (let i = 0; i < usdcCount; i++) {
    usdcDiscs.push({ y: -i * 9 - 1, c: "#1D5BD0", t: "" });
    usdcDiscs.push({ y: -i * 9 - 6, c: USDC_COLOR, t: i === usdcCount - 1 ? "USDC" : "" });
  }

  const W: Record<Waypoint, [number, number]> = {
    wallet: proj(-526, -86, -4),
    bs: proj(-370, -72, 0),
    be: proj(-154, -72, 0),
    vault: proj(120, -126, 0),
    stack: proj(330, -usdcCount * 9 - 6, 130),
  };
  const liftFor: Record<Waypoint, Actor> = { wallet: "wallet", bs: "bridge", be: "bridge", vault: "vault", stack: "shop" };
  const pin = (n: string, id: Actor, x: number, y: number, z: number): Pin => {
    const p = proj(x, y, z);
    return { n, x: p[0].toFixed(1), y: (p[1] + lift(id)).toFixed(1), on: active(id) && step > 1 };
  };
  const nftAnchor = proj(160, -126, -40);
  const pk = W[cur.wp];
  const pkUsdc = !!cur.usdc;

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

  return {
    coin,
    isRefund,
    step,
    total: seq.length,
    cur,
    active,
    lf: { wallet: L("wallet"), bridge: L("bridge"), worker: L("worker"), vault: L("vault"), asst: L("asst"), shop: L("shop") },
    walletDiscs,
    usdcDiscs,
    route: pts([W.wallet, W.bs, W.be, W.vault, proj(330, -20, 130)]),
    branch: pts([proj(120, -40, 50), proj(130, -60, 160)]),
    branchOn: isRefund && step >= 8,
    reverse: isRefund && step >= 9,
    nft: { x: (nftAnchor[0] + 24).toFixed(1), y: (nftAnchor[1] - 40 + lift("vault")).toFixed(1), on: !!cur.nft },
    nftState: isRefund && step >= 8 ? "Refund in review" : "In escrow · refund window open",
    windowPct: cur.win ? "62%" : cur.nft ? "8%" : "0%",
    pins: [
      pin("02", "wallet", -520, -150, 0),
      pin("03", "bridge", -262, -170, 0),
      pin("04", "worker", -30, -150, 200),
      pin("05", "vault", 70, -150, 60),
      pin("R", "asst", 130, -140, 210),
      pin("06", "shop", 470, -150, 0),
    ],
    puck: {
      x: pk[0].toFixed(1),
      y: (pk[1] + lift(liftFor[cur.wp]) - 16).toFixed(1),
      on: cur.vis,
      color: pkUsdc ? USDC_COLOR : coin.color,
      fg: pkUsdc ? "#FFFFFF" : "#111111",
      text: pkUsdc ? "USDC" : coin.label,
      tag: pkUsdc ? "24.00 USDC" : `$24 in ${coin.label}`,
    },
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
