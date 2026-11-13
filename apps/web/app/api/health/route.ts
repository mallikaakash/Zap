import { getConfig } from "@uc/core";
import { db } from "@uc/db";
import { CORS } from "@/lib/api";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Liveness/readiness for Cloud Run, uptime checks and judges: is the app up and can it read its database?
 * Cheap on purpose (no chain RPC). 200 when healthy, 503 otherwise.
 */
export async function GET() {
  const started = Date.now();
  let database: "ok" | "error" = "ok";
  try {
    await db.$queryRawUnsafe("SELECT 1");
  } catch {
    database = "error";
  }
  const c = getConfig();
  const ok = database === "ok";
  return NextResponse.json(
    { ok, mode: c.mode, networkId: c.networkId, database, ms: Date.now() - started, time: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { ...CORS, "cache-control": "no-store" } },
  );
}
