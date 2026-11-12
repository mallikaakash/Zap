import { NextResponse } from "next/server";
import { UserError } from "@uc/core";

/** The session API is called from merchants' sites by the pay button, so it is open to any origin. It carries no cookies. */
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
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
    console.error("[api]", e);
    const message = e instanceof Error ? e.message : "Unexpected error";
    return json({ error: /is not set/.test(message) ? message : "Something went wrong on our side. Please try again." }, 500);
  }
}

export type Ctx<K extends string = "id"> = { params: Promise<Record<K, string>> };
