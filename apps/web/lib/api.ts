import { NextResponse } from "next/server";
import { getConfig, UserError } from "@uc/core";

/** The session API is called from merchants' sites by the pay button, so it is open to any origin. It carries no cookies. */
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-uc-token",
  "Access-Control-Max-Age": "86400",
};

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { ...CORS, "Cache-Control": "no-store" } });
}

export function preflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const b: unknown = await req.json();
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
  } catch {
    throw new UserError("Request body must be JSON");
  }
}

/** Run a handler; turn errors into `{ error }` JSON with a sensible status. */
export async function handle(fn: () => Promise<unknown>): Promise<NextResponse> {
  try {
    return json(await fn());
  } catch (e) {
    if (e instanceof UserError) return json({ error: e.message }, e.status);
    // NEAR RPC rate limit (HTTP 429): say so plainly instead of "something went wrong".
    const err = e as { name?: string; statusCode?: number; data?: { statusCode?: number }; message?: string } | null;
    if (err?.name === "RpcBusyError" || err?.statusCode === 429 || err?.data?.statusCode === 429 || /too many requests/i.test(String(err?.message ?? ""))) {
      console.warn("[api] NEAR RPC rate limited (429)");
      return json({ error: "The NEAR network is busy right now. Nothing was changed. Try again in a minute." }, 503);
    }
    console.error("[api]", e);
    const message = e instanceof Error ? e.message : "Unexpected error";
    return json({ error: /is not set/.test(message) ? message : "Something went wrong on our side. Please try again." }, 500);
  }
}

export type Ctx<K extends string = "id"> = { params: Promise<Record<K, string>> };

/** The session cookie set by a password login (HttpOnly; its value is the shop's secret token). */
export const SESSION_COOKIE = "zap_session";
const SESSION_DAYS = 30;

function cookieValue(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim()) || null;
  }
  return null;
}

/** The seller's secret token: `x-uc-token` (private link), `?t=` on GET, or the session cookie. */
export function tokenOf(req: Request): string | null {
  return req.headers.get("x-uc-token") ?? new URL(req.url).searchParams.get("t") ?? cookieValue(req, SESSION_COOKIE);
}

export function sessionOf(req: Request): string | null {
  return cookieValue(req, SESSION_COOKIE);
}

/** Start (token) or end (null) the seller's session on a successful response. */
export function withSession(res: NextResponse, token: string | null): NextResponse {
  if (!res.ok) return res;
  const secure = getConfig().publicUrl.startsWith("https://");
  res.cookies.set(SESSION_COOKIE, token ?? "", { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: token ? SESSION_DAYS * 86400 : 0 });
  return res;
}

/** A coarse client key for throttling (first X-Forwarded-For hop). */
export function clientKey(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim();
}
