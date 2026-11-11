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

  const chain = getChain();
  const id = await ensureDemoAccount(name);
  if (await db.merchant.findUnique({ where: { id } })) throw new UserError(`A shop called "${name}" already exists (${id})`, 409);
  const payout = input.payoutAccount?.trim() || id;
  if (!(await chain.accountExists(payout))) throw new UserError(`Payout account ${payout} does not exist on ${getConfig().networkId}`);
  await chain.ensureUsdcStorage(id, payout);
  await chain.registerMerchant(id, { payout, approver: id, guardThreshold, defaultWindowSecs: windowSecs });
  return db.merchant.create({
    data: {
      id,
      name,
      payoutAccount: payout,
      approverAccount: id,
      guardThreshold,
      defaultWindowSecs: windowSecs,
      webhookUrl: input.webhookUrl || null,
      webhookSecret: "whsec_" + randomBytes(24).toString("hex"),
      policyJson: JSON.stringify(DEFAULT_POLICY),
    },
  });
}

export interface MerchantUpdate {
  name?: string;
  payoutAccount?: string;
  guardThreshold?: string;
  defaultWindowSecs?: number;
  webhookUrl?: string | null;
  policy?: Partial<RefundPolicy>;
  button?: Record<string, unknown>;
}

export async function updateMerchant(id: string, u: MerchantUpdate): Promise<Merchant> {
  const m = await db.merchant.findUnique({ where: { id } });
  if (!m) throw new UserError("Merchant not found", 404);
  const chain = getChain();
  const next = {
    payoutAccount: u.payoutAccount?.trim() || m.payoutAccount,
    guardThreshold: u.guardThreshold ?? m.guardThreshold,
    defaultWindowSecs: u.defaultWindowSecs ?? m.defaultWindowSecs,
  };
  if (!isMinor(next.guardThreshold)) throw new UserError("guardThreshold must be an integer string in minor units");
  if (!Number.isInteger(next.defaultWindowSecs) || next.defaultWindowSecs < 0) throw new UserError("defaultWindowSecs must be a non-negative integer");
  if (u.webhookUrl && !validUrl(u.webhookUrl)) throw new UserError("webhookUrl must be an http(s) URL");

  const onChainChanged = next.payoutAccount !== m.payoutAccount || next.guardThreshold !== m.guardThreshold || next.defaultWindowSecs !== m.defaultWindowSecs;
  if (onChainChanged) {
    if (!(await ensureSigner(id))) throw new UserError("This demo does not hold the key for that merchant account", 403);
    if (!(await chain.accountExists(next.payoutAccount))) throw new UserError(`Payout account ${next.payoutAccount} does not exist`);
    await chain.ensureUsdcStorage(id, next.payoutAccount);
    await chain.registerMerchant(id, { payout: next.payoutAccount, approver: m.approverAccount, guardThreshold: next.guardThreshold, defaultWindowSecs: next.defaultWindowSecs });
  }
  return db.merchant.update({
    where: { id },
    data: {
      ...next,
      name: u.name?.trim().slice(0, 60) || m.name,
      webhookUrl: u.webhookUrl === undefined ? m.webhookUrl : u.webhookUrl || null,
      policyJson: u.policy ? JSON.stringify({ ...parsePolicy(m.policyJson), ...u.policy }) : m.policyJson,
      buttonJson: u.button ? JSON.stringify(u.button) : m.buttonJson,
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
