import { randomBytes } from "node:crypto";
import { db, type Merchant } from "@uc/db";
import { isValidAccountId } from "@uc/chain";
import { dashboardUrl, isEmail, sendEmail } from "./email";
import { UserError } from "./errors";
import { fromMinor, isMinor } from "./money";
import { DEFAULT_POLICY, parsePolicy, type RefundPolicy } from "./refund-agent";
import { custodialAllowed, ensureDemoAccount, getChain, getConfig } from "./runtime";

/**
 * Merchants sign up with a business name, an email and the NEAR account they want to be paid to.
 * They never sign a transaction: the settlement worker registers them on the receipt
 * contract with `register_merchant_for` (operator registration, see DECISIONS.md).
 * The seller's merchant id IS their payout account, so their snippet reads
 * `<pay-button merchant="their-account.near" …>`.
 */
export interface MerchantInput {
  name: string;
  email?: string;
  /** Existing NEAR account to be paid. Local demo only: a plain name creates a throwaway account. */
  payoutAccount?: string;
  guardThreshold?: string;
  defaultWindowSecs?: number;
  responseSecs?: number;
  dailyRefundCap?: string;
  aiTriage?: boolean;
  autoApproveMax?: string;
  vetoSecs?: number;
  minOrder?: string;
  webhookUrl?: string | null;
}

function validUrl(u: string): boolean {
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:";
  } catch {
    return false;
  }
}

interface OnChain {
  guardThreshold: string;
  defaultWindowSecs: number;
  responseSecs: number;
  dailyRefundCap: string;
  aiTriage: boolean;
  autoApproveMax: string;
  vetoSecs: number;
}

function checkOnChain(c: OnChain): void {
  for (const k of ["guardThreshold", "dailyRefundCap", "autoApproveMax"] as const) if (!isMinor(c[k])) throw new UserError(`${k} must be an integer string in minor units`);
  for (const k of ["defaultWindowSecs", "responseSecs", "vetoSecs"] as const)
    if (!Number.isInteger(c[k]) || c[k] < 0 || c[k] > 365 * 86400) throw new UserError(`${k} must be a whole number of seconds between 0 and one year`);
}

/** Resolve the account the seller wants to be paid to. */
async function resolvePayout(input: string | undefined, name: string): Promise<string> {
  const raw = (input ?? "").trim().toLowerCase();
  const chain = getChain();
  // Implicit accounts (64 hex, what most wallets create) can receive USDC before they hold any NEAR.
  if (/^[0-9a-f]{64}$/.test(raw)) return raw;
  if (raw && isValidAccountId(raw) && raw.includes(".")) {
    if (!(await chain.accountExists(raw))) throw new UserError(`${raw} does not exist on NEAR ${getConfig().networkId}. Create it in any NEAR wallet first, or paste your wallet's 64-character address.`);
    return raw;
  }
  if (custodialAllowed() && getConfig().mode === "local") return ensureDemoAccount(raw || name);
  throw new UserError("Enter the NEAR account you want to be paid to, for example yourname.near");
}

export async function registerMerchant(input: MerchantInput): Promise<Merchant> {
  const name = String(input.name ?? "").trim();
  if (name.length < 2 || name.length > 60) throw new UserError("Give your business a name (2–60 characters)");
  const email = input.email?.trim().toLowerCase() || null;
  if (email && !isEmail(email)) throw new UserError("That email address does not look right");
  const cfg: OnChain = {
    guardThreshold: input.guardThreshold ?? "50000000",
    defaultWindowSecs: input.defaultWindowSecs ?? 7 * 86400,
    responseSecs: input.responseSecs ?? 72 * 3600,
    dailyRefundCap: input.dailyRefundCap ?? "1000000000",
    aiTriage: input.aiTriage ?? true,
    autoApproveMax: input.autoApproveMax ?? "20000000",
    vetoSecs: input.vetoSecs ?? 12 * 3600,
  };
  checkOnChain(cfg);
  const minOrder = input.minOrder ?? "1000000";
  if (!isMinor(minOrder)) throw new UserError("minOrder must be an integer string in minor units");
  if (input.webhookUrl && !validUrl(input.webhookUrl)) throw new UserError("webhookUrl must be an http(s) URL");

  const payout = await resolvePayout(input.payoutAccount, name);
  if (await db.merchant.findUnique({ where: { id: payout } })) throw new UserError(`${payout} already has a merchant account here. Open its dashboard link instead.`, 409);
  const m = await db.merchant.create({
    data: {
      id: payout,
      name,
      email,
      payoutAccount: payout,
      // Refund decisions for operator-registered sellers are signed by our relayer on the seller's behalf (dashboard login).
      approverAccount: getConfig().relayer,
      ...cfg,
      minOrder,
      webhookUrl: input.webhookUrl || null,
      webhookSecret: "whsec_" + randomBytes(24).toString("hex"),
      dashboardToken: randomBytes(18).toString("base64url"),
      policyJson: JSON.stringify(DEFAULT_POLICY),
      chainState: "pending",
    },
  });
  if (email)
    await sendEmail({
      to: email,
      subject: `"${name}" is ready to take payments`,
      lines: [
        `"${name}" is set up on Zap.`,
        `Payments are paid out in USDC to ${payout} on NEAR, after each order's refund period.`,
        "Keep this email: the button below is your private dashboard link. Anyone with it can manage your merchant account.",
      ],
      button: { label: "Open my dashboard", url: dashboardUrl(m) },
    });
  return m;
}

export interface MerchantUpdate extends Partial<OnChain> {
  name?: string;
  email?: string | null;
  minOrder?: string;
  webhookUrl?: string | null;
  policy?: Partial<RefundPolicy>;
  button?: Record<string, unknown>;
  blockedRefundAddresses?: string[];
}

/** Settings changes. Anything that lives on chain is re-registered by the worker. */
export async function updateMerchant(id: string, u: MerchantUpdate): Promise<Merchant> {
  const m = await db.merchant.findUnique({ where: { id } });
  if (!m) throw new UserError("Merchant not found", 404);
  const cfg: OnChain = {
    guardThreshold: u.guardThreshold ?? m.guardThreshold,
    defaultWindowSecs: u.defaultWindowSecs ?? m.defaultWindowSecs,
    responseSecs: u.responseSecs ?? m.responseSecs,
    dailyRefundCap: u.dailyRefundCap ?? m.dailyRefundCap,
    aiTriage: u.aiTriage ?? m.aiTriage,
    autoApproveMax: u.autoApproveMax ?? m.autoApproveMax,
    vetoSecs: u.vetoSecs ?? m.vetoSecs,
  };
  checkOnChain(cfg);
  if (u.minOrder !== undefined && !isMinor(u.minOrder)) throw new UserError("minOrder must be an integer string in minor units");
  if (u.webhookUrl && !validUrl(u.webhookUrl)) throw new UserError("webhookUrl must be an http(s) URL");
  if (u.email && !isEmail(u.email)) throw new UserError("That email address does not look right");
  const onChainChanged = (Object.keys(cfg) as Array<keyof OnChain>).some((k) => cfg[k] !== m[k]);
  return db.merchant.update({
    where: { id },
    data: {
      ...cfg,
      ...(onChainChanged ? { chainState: "pending", chainError: null } : {}),
      minOrder: u.minOrder ?? m.minOrder,
      name: u.name?.trim().slice(0, 60) || m.name,
      email: u.email === undefined ? m.email : u.email?.trim().toLowerCase() || null,
      webhookUrl: u.webhookUrl === undefined ? m.webhookUrl : u.webhookUrl || null,
      policyJson: u.policy ? JSON.stringify({ ...parsePolicy(m.policyJson), ...u.policy }) : m.policyJson,
      buttonJson: u.button ? JSON.stringify(u.button) : m.buttonJson,
      blockedRefundAddresses: u.blockedRefundAddresses ? JSON.stringify(u.blockedRefundAddresses.map((a) => String(a).trim().toLowerCase()).filter(Boolean).slice(0, 500)) : m.blockedRefundAddresses,
    },
  });
}

/** NEAR the operator (executor) prepays into a new seller's receipt storage (~0.014 NEAR per receipt). */
export const SELLER_STORAGE_PREPAY = "0.15 NEAR";
/** Top up when a seller has room for fewer than this many receipts. */
const STORAGE_LOW_RECEIPTS = 4n;
const STORAGE_TOPUP = "0.15 NEAR";

/** Worker step: put pending sellers (new, or with changed limits) on chain. */
export async function tickMerchants(executor: string, log: (m: string) => void = () => {}): Promise<void> {
  const pending = await db.merchant.findMany({ where: { chainState: "pending" }, take: 10 });
  for (const m of pending) {
    try {
      const existing = await getChain().getMerchant(m.id);
      await getChain().ensureUsdcStorage(executor, m.payoutAccount);
      await getChain().registerMerchantFor(
        executor,
        m.id,
        { payout: m.payoutAccount, approver: m.approverAccount, guardThreshold: m.guardThreshold, defaultWindowSecs: m.defaultWindowSecs, responseSecs: m.responseSecs, dailyRefundCap: m.dailyRefundCap, aiTriage: m.aiTriage, autoApproveMax: m.autoApproveMax, vetoSecs: m.vetoSecs },
        existing ? undefined : SELLER_STORAGE_PREPAY,
      );
      await db.merchant.update({ where: { id: m.id }, data: { chainState: "active", chainError: null } });
      log(`seller ${m.id}: ${existing ? "settings updated" : "registered"} on chain`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.merchant.update({ where: { id: m.id }, data: { chainError: msg } });
      log(`seller ${m.id}: registration failed: ${msg}`);
    }
  }
}

/** Worker step: keep every active seller's prepaid receipt storage topped up, so payments are never returned for lack of it. */
export async function tickStorage(executor: string, log: (m: string) => void = () => {}): Promise<void> {
  const chain = getChain();
  const sellers = await db.merchant.findMany({ where: { chainState: "active" }, take: 50 });
  if (sellers.length === 0) return;
  const cost = BigInt((await chain.getConfig()).receiptStorageCost);
  for (const s of sellers) {
    try {
      const m = await chain.getMerchant(s.id);
      if (!m || BigInt(m.storageBalance) >= cost * STORAGE_LOW_RECEIPTS) continue;
      await chain.fundStorage(executor, s.id, STORAGE_TOPUP);
      log(`seller ${s.id}: receipt storage topped up (${STORAGE_TOPUP})`);
    } catch (e) {
      log(`seller ${s.id}: storage top-up failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/** The seller's login for now: their secret dashboard link. */
export async function authMerchant(id: string, token: string | null | undefined): Promise<Merchant> {
  const m = await db.merchant.findUnique({ where: { id } });
  if (!m || !token || token !== m.dashboardToken) throw new UserError("Open your dashboard with the private link from your sign-up email.", 401);
  return m;
}

/** Dashboard view (secret link holders only). */
export function merchantView(m: Merchant) {
  return {
    id: m.id,
    name: m.name,
    email: m.email,
    payoutAccount: m.payoutAccount,
    approverAccount: m.approverAccount,
    chainState: m.chainState,
    chainError: m.chainError,
    guardThreshold: m.guardThreshold,
    defaultWindowSecs: m.defaultWindowSecs,
    responseSecs: m.responseSecs,
    dailyRefundCap: m.dailyRefundCap,
    aiTriage: m.aiTriage,
    autoApproveMax: m.autoApproveMax,
    vetoSecs: m.vetoSecs,
    minOrder: m.minOrder,
    blockedRefundAddresses: JSON.parse(m.blockedRefundAddresses || "[]") as string[],
    webhookUrl: m.webhookUrl,
    webhookSecret: m.webhookSecret,
    dashboardUrl: dashboardUrl(m),
    policy: parsePolicy(m.policyJson),
    button: JSON.parse(m.buttonJson || "{}") as Record<string, unknown>,
    createdAt: m.createdAt.toISOString(),
  };
}

/** What a shopper may see. */
export function publicMerchantView(m: Merchant) {
  return { id: m.id, name: m.name, defaultWindowSecs: m.defaultWindowSecs, minOrder: m.minOrder, minOrderUsd: fromMinor(m.minOrder), active: m.chainState === "active" };
}
