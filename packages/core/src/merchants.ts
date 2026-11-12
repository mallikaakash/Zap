import { randomBytes } from "node:crypto";
import { db, type Merchant } from "@uc/db";
import { UserError } from "./errors";
import { isMinor } from "./money";
import { DEFAULT_POLICY, parsePolicy, type RefundPolicy } from "./refund-agent";
import { ensureDemoAccount, ensureSigner, getChain, getConfig } from "./runtime";

export interface MerchantInput {
  name: string;
  /** Account that receives released USDC. Defaults to the merchant account. */
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

/** NEAR prepaid per new merchant for receipt storage (0.01 NEAR per receipt on chain). */
const STORAGE_PREPAY = "1 NEAR";

function validUrl(u: string): boolean {
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Register a merchant. Outside live mode the app creates and holds a demo account
 * (`<name>.<parent>`) for the merchant and signs `register_merchant` with it.
 */
export async function registerMerchant(input: MerchantInput): Promise<Merchant> {
  const name = String(input.name ?? "").trim();
  if (name.length < 2 || name.length > 60) throw new UserError("Give the shop a name (2–60 characters)");
  const guardThreshold = input.guardThreshold ?? "50000000";
  if (!isMinor(guardThreshold)) throw new UserError("guardThreshold must be an integer string in minor units");
  const windowSecs = input.defaultWindowSecs ?? 7 * 86400;
  if (!Number.isInteger(windowSecs) || windowSecs < 0 || windowSecs > 365 * 86400) throw new UserError("defaultWindowSecs must be between 0 and one year");
  if (input.webhookUrl && !validUrl(input.webhookUrl)) throw new UserError("webhookUrl must be an http(s) URL");

  const cfg = {
    guardThreshold,
    defaultWindowSecs: windowSecs,
    responseSecs: input.responseSecs ?? 72 * 3600,
    dailyRefundCap: input.dailyRefundCap ?? "1000000000",
    aiTriage: input.aiTriage ?? true,
    autoApproveMax: input.autoApproveMax ?? "20000000",
    vetoSecs: input.vetoSecs ?? 12 * 3600,
  };
  checkOnChain(cfg);
  const minOrder = input.minOrder ?? "5000000";
  if (!isMinor(minOrder)) throw new UserError("minOrder must be an integer string in minor units");

  const chain = getChain();
  const id = await ensureDemoAccount(name);
  if (await db.merchant.findUnique({ where: { id } })) throw new UserError(`A shop called "${name}" already exists (${id})`, 409);
  const payout = input.payoutAccount?.trim() || id;
  if (!(await chain.accountExists(payout))) throw new UserError(`Payout account ${payout} does not exist on ${getConfig().networkId}`);
  await chain.ensureUsdcStorage(id, payout);
  await chain.registerMerchant(id, { payout, approver: id, ...cfg }, STORAGE_PREPAY);
  return db.merchant.create({
    data: {
      id,
      name,
      payoutAccount: payout,
      approverAccount: id,
      ...cfg,
      minOrder,
      webhookUrl: input.webhookUrl || null,
      webhookSecret: "whsec_" + randomBytes(24).toString("hex"),
      policyJson: JSON.stringify(DEFAULT_POLICY),
    },
  });
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

export interface MerchantUpdate extends Partial<OnChain> {
  name?: string;
  payoutAccount?: string;
  minOrder?: string;
  webhookUrl?: string | null;
  policy?: Partial<RefundPolicy>;
  button?: Record<string, unknown>;
  blockedRefundAddresses?: string[];
}

export async function updateMerchant(id: string, u: MerchantUpdate): Promise<Merchant> {
  const m = await db.merchant.findUnique({ where: { id } });
  if (!m) throw new UserError("Merchant not found", 404);
  const chain = getChain();
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
  const payoutAccount = u.payoutAccount?.trim() || m.payoutAccount;
  if (u.minOrder !== undefined && !isMinor(u.minOrder)) throw new UserError("minOrder must be an integer string in minor units");
  if (u.webhookUrl && !validUrl(u.webhookUrl)) throw new UserError("webhookUrl must be an http(s) URL");

  const onChainChanged = payoutAccount !== m.payoutAccount || (Object.keys(cfg) as Array<keyof OnChain>).some((k) => cfg[k] !== m[k]);
  if (onChainChanged) {
    if (!(await ensureSigner(id))) throw new UserError("This demo does not hold the key for that merchant account. Sign the change from the merchant's own wallet.", 403);
    if (!(await chain.accountExists(payoutAccount))) throw new UserError(`Payout account ${payoutAccount} does not exist`);
    await chain.ensureUsdcStorage(id, payoutAccount);
    await chain.registerMerchant(id, { payout: payoutAccount, approver: m.approverAccount, ...cfg });
  }
  return db.merchant.update({
    where: { id },
    data: {
      ...cfg,
      payoutAccount,
      minOrder: u.minOrder ?? m.minOrder,
      name: u.name?.trim().slice(0, 60) || m.name,
      webhookUrl: u.webhookUrl === undefined ? m.webhookUrl : u.webhookUrl || null,
      policyJson: u.policy ? JSON.stringify({ ...parsePolicy(m.policyJson), ...u.policy }) : m.policyJson,
      buttonJson: u.button ? JSON.stringify(u.button) : m.buttonJson,
      blockedRefundAddresses: u.blockedRefundAddresses ? JSON.stringify(u.blockedRefundAddresses.map((a) => String(a).trim().toLowerCase()).filter(Boolean).slice(0, 500)) : m.blockedRefundAddresses,
    },
  });
}

/** Dashboard view. The webhook secret is shown to the merchant, so only return this from merchant routes. */
export function merchantView(m: Merchant) {
  return {
    id: m.id,
    name: m.name,
    payoutAccount: m.payoutAccount,
    approverAccount: m.approverAccount,
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
    policy: parsePolicy(m.policyJson),
    button: JSON.parse(m.buttonJson || "{}") as Record<string, unknown>,
    createdAt: m.createdAt.toISOString(),
  };
}

/** What a shopper may see. */
export function publicMerchantView(m: Merchant) {
  return { id: m.id, name: m.name, defaultWindowSecs: m.defaultWindowSecs };
}
