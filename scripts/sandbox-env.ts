/**
 * Import this FIRST in any script that must only ever touch the local sandbox (e.g. scripts/e2e.ts).
 *
 * Config normally loads the repo-root `.env` before `.uc/runtime.json`, and never overrides what is
 * already set. On a machine that also holds a live `.env`, a sandbox script would otherwise pick up
 * live settings (mainnet RPC, real 1Click, Resend). This pins every sandbox setting from
 * `.uc/runtime.json`, blanks the keys that reach outside services, and refuses to continue unless
 * the result points at the local sandbox.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, ".uc", "runtime.json");
if (!existsSync(file)) {
  console.error("✖ No local sandbox found (.uc/runtime.json). Start `pnpm demo` (or `pnpm demo --setup-only`) first.");
  process.exit(1);
}
const runtime = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
Object.assign(process.env, runtime);
// Outside services: empty means "not configured" (config only fills variables that are undefined).
for (const k of ["RESEND_API_KEY", "RESEND", "NEARAI_API_KEY", "CONFIRM_REAL_MONEY"]) process.env[k] = "";

if (process.env.UC_MODE !== "local" || process.env.NEAR_NETWORK_ID !== "localnet" || !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(process.env.NEAR_RPC_URL ?? "")) {
  console.error(`✖ Refusing to run: this script only runs against the local sandbox (got mode=${process.env.UC_MODE}, network=${process.env.NEAR_NETWORK_ID}).`);
  process.exit(1);
}
