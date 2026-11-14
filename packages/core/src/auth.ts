/**
 * Seller login. A shop's session is its secret dashboard token (the same secret as the private
 * link), carried in an HttpOnly cookie after a password login. Passwords are stored as scrypt
 * hashes only.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { db } from "@uc/db";
import { dashboardUrl, sendEmail } from "./email";
import { UserError } from "./errors";

type Merchant = NonNullable<Awaited<ReturnType<typeof db.merchant.findUnique>>>;

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEYLEN = 64;

export const PASSWORD_MIN = 8;

export function checkPassword(pw: unknown): string {
  if (typeof pw !== "string" || pw.length < PASSWORD_MIN) throw new UserError(`Use a password of at least ${PASSWORD_MIN} characters.`);
  if (pw.length > 200) throw new UserError("That password is too long.");
  return pw;
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pw, salt, KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(pw: string, stored: string | null | undefined): Promise<boolean> {
  const [kind, saltHex, hashHex] = (stored ?? "").split("$");
  if (kind !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length === 0) return false;
  const got = await scrypt(pw, Buffer.from(saltHex, "hex"), expected.length);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

// Simple per-key throttle. One Cloud Run instance serves the app, so memory is enough.
const attempts = new Map<string, { n: number; until: number }>();
const WINDOW_MS = 60_000;

function throttle(key: string, max: number): void {
  const now = Date.now();
  const a = attempts.get(key);
  if (a && a.until > now && a.n >= max) throw new UserError("Too many attempts. Wait a minute and try again.", 429);
  if (!a || a.until <= now) attempts.set(key, { n: 1, until: now + WINDOW_MS });
  else a.n++;
  if (attempts.size > 5000) for (const [k, v] of attempts) if (v.until <= now) attempts.delete(k);
}

const normId = (id: unknown) => String(id ?? "").trim().toLowerCase();

// Used when the shop does not exist, so a wrong account name costs the same time as a wrong password.
const DUMMY_HASH = `scrypt$${"00".repeat(16)}$${"00".repeat(KEYLEN)}`;

/** Check a shop's password. The same message for an unknown shop and a wrong password. */
export async function loginMerchant(id: unknown, password: unknown, clientKey = ""): Promise<Merchant> {
  const mid = normId(id);
  if (!mid || typeof password !== "string" || !password) throw new UserError("Enter your NEAR account and password.");
  throttle(`login:${mid}`, 8);
  if (clientKey) throttle(`login-ip:${clientKey}`, 30);
  const m = await db.merchant.findUnique({ where: { id: mid } });
  const ok = await verifyPassword(password, m?.passwordHash ?? DUMMY_HASH);
  if (m && ok) return m;
  if (m && !m.passwordHash) throw new UserError("This shop has no password yet. Use “Forgot password?” to get a sign-in link by email, then set one in Settings.", 401);
  throw new UserError("Wrong NEAR account or password.", 401);
}

export async function setMerchantPassword(id: string, password: unknown): Promise<void> {
  await db.merchant.update({ where: { id }, data: { passwordHash: await hashPassword(checkPassword(password)) } });
}

/** Email the shop's sign-in link to its saved address. Never reveals whether the shop exists. */
export async function sendSignInLink(id: unknown, clientKey = ""): Promise<void> {
  const mid = normId(id);
  if (!mid) throw new UserError("Enter your NEAR account.");
  throttle(`forgot:${mid}`, 3);
  if (clientKey) throttle(`forgot-ip:${clientKey}`, 10);
  const m = await db.merchant.findUnique({ where: { id: mid } });
  if (!m?.email) return;
  await sendEmail({
    to: m.email,
    subject: `Sign in to "${m.name}" on Zap`,
    lines: [
      "Here is your sign-in link.",
      `It opens the dashboard of "${m.name}" (${m.id}). Then set a new password in Settings so you can log in normally.`,
      "If you did not ask for this, you can ignore this email.",
    ],
    button: { label: "Sign in to my dashboard", url: dashboardUrl(m) },
  });
}

/** The shop a session cookie belongs to, if any. */
export async function merchantBySession(token: string | null | undefined): Promise<Merchant | null> {
  if (!token) return null;
  return db.merchant.findUnique({ where: { dashboardToken: token } });
}
