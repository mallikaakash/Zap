/**
 * Email. Every message is stored (the dev inbox at /dev/inbox in local mode, an audit
 * log in live mode), then sent through the first provider that is configured:
 *
 * 1. SMTP (SMTP_USER + SMTP_PASS): e.g. a Gmail account with an app password. Delivers to
 *    any address, about 500 recipients a day on a normal Gmail account. SMTP_HOST and
 *    SMTP_PORT default to smtp.gmail.com:465.
 * 2. Resend (RESEND_API_KEY): without a verified domain it only delivers to the Resend
 *    account owner's own address, from `onboarding@resend.dev`.
 *
 * EMAIL_FROM sets the sender, e.g. `Zap <zap.payments.demo@gmail.com>`.
 */
import nodemailer, { type Transporter } from "nodemailer";
import { db } from "@uc/db";
import { env, getConfig } from "./runtime";

export interface Mail {
  to: string;
  subject: string;
  /** Plain paragraphs; the first line is the headline. */
  lines: string[];
  /** Optional call to action. */
  button?: { label: string; url: string };
}

export const isEmail = (s: unknown): s is string => typeof s === "string" && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function render(m: Mail): { text: string; html: string } {
  const text = [...m.lines, ...(m.button ? ["", `${m.button.label}: ${m.button.url}`] : []), "", "— Zap"].join("\n");
  const [head, ...rest] = m.lines;
  const html = `<!doctype html><html><body style="margin:0;background:#f6f7fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">
<p style="font-weight:600;color:#4f46e5;margin:0 0 16px">Zap</p>
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:24px">
<h1 style="font-size:18px;margin:0 0 12px">${esc(head ?? "")}</h1>
${rest.map((l) => `<p style="font-size:14px;line-height:1.6;margin:0 0 10px;color:#334155">${esc(l)}</p>`).join("\n")}
${m.button ? `<p style="margin:20px 0 0"><a href="${esc(m.button.url)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:10px">${esc(m.button.label)}</a></p>` : ""}
</div>
<p style="font-size:12px;color:#64748b;margin:16px 0 0">Funds are held by a public NEAR contract, not by a company. Hackathon prototype, unaudited.</p>
</div></body></html>`;
  return { text, html };
}

let smtp: { key: string; t: Transporter } | null = null;

/** The SMTP transport when SMTP_USER and SMTP_PASS are set (reused across sends). */
function smtpTransport(): { t: Transporter; user: string } | null {
  const user = env().SMTP_USER?.trim();
  const pass = env().SMTP_PASS?.replace(/\s+/g, ""); // Google shows app passwords as "abcd efgh ijkl mnop"
  if (!user || !pass) return null;
  const host = env().SMTP_HOST || "smtp.gmail.com";
  const port = Number(env().SMTP_PORT || 465);
  const key = `${host}:${port}:${user}`;
  if (smtp?.key !== key) smtp = { key, t: nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 }) };
  return { t: smtp.t, user };
}

export type SendResult = { status: "sent" | "failed" | "dev"; via: "smtp" | "resend" | "none"; error?: string } | null;

/** Store and (if configured) send. Never throws: email must not break a payment flow. */
export async function sendEmail(m: Mail): Promise<SendResult> {
  if (!isEmail(m.to)) return null;
  const { text, html } = render(m);
  const row = await db.email.create({ data: { to: m.to, subject: m.subject.slice(0, 200), text, html, status: "queued" } }).catch(() => null);
  if (!row) return null;
  const mailer = smtpTransport();
  if (mailer) {
    try {
      await mailer.t.sendMail({ from: env().EMAIL_FROM || `Zap <${mailer.user}>`, to: m.to, subject: m.subject, text, html });
      await db.email.update({ where: { id: row.id }, data: { status: "sent" } });
      return { status: "sent", via: "smtp" };
    } catch (e) {
      const error = `SMTP: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500);
      await db.email.update({ where: { id: row.id }, data: { status: "failed", error } }).catch(() => {});
      return { status: "failed", via: "smtp", error };
    }
  }
  const key = env().RESEND_API_KEY || env().RESEND;
  if (!key) {
    await db.email.update({ where: { id: row.id }, data: { status: "dev" } }).catch(() => {});
    return { status: "dev", via: "none" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env().EMAIL_FROM || "Zap <onboarding@resend.dev>", to: [m.to], subject: m.subject, text, html }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await db.email.update({ where: { id: row.id }, data: { status: "sent" } });
    return { status: "sent", via: "resend" };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.email.update({ where: { id: row.id }, data: { status: "failed", error } }).catch(() => {});
    return { status: "failed", via: "resend", error };
  }
}

export const dashboardUrl = (m: { id: string; dashboardToken: string }) => `${getConfig().publicUrl}/dashboard?m=${encodeURIComponent(m.id)}&t=${m.dashboardToken}`;
