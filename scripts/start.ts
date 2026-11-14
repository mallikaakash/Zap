/**
 * `pnpm start` — production: web app (next build + next start) and the settlement worker,
 * against whatever the repo-root .env says (live mainnet after `pnpm deploy:mainnet`).
 * Unlike `pnpm demo` it never resets the database.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "@uc/db";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv();
const need = ["DATABASE_URL", "NEAR_RPC_URL", "NEAR_NETWORK_ID", "UC_RECEIPTS_CONTRACT", "UC_USDC_CONTRACT", "UC_EXECUTOR_ACCOUNT", "UC_EXECUTOR_KEY", "PUBLIC_URL"];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`✖ Missing ${missing.join(", ")}. Run pnpm deploy:mainnet first (it writes .env), or see .env.example.`);
  process.exit(1);
}
if (process.env.UC_MODE === "live" && process.env.CONFIRM_REAL_MONEY !== "yes") {
  console.error("✖ UC_MODE=live needs CONFIRM_REAL_MONEY=yes in .env.");
  process.exit(1);
}
mkdirSync(path.join(ROOT, ".uc"), { recursive: true });

const run = (args: string[]) => {
  const r = spawnSync("pnpm", args, { cwd: ROOT, stdio: "inherit", env: process.env });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
console.log(`▸ mode=${process.env.UC_MODE ?? "local"} network=${process.env.NEAR_NETWORK_ID} contract=${process.env.UC_RECEIPTS_CONTRACT}`);
const dbPush = ["--filter", "@uc/db", "exec", "prisma", "db", "push", "--skip-generate"];
const acceptDataLoss =
  process.env.UC_PRISMA_ACCEPT_DATA_LOSS === "yes" || Boolean(process.env.LITESTREAM_REPLICA_URL);
if (acceptDataLoss) dbPush.push("--accept-data-loss");
console.log(`▸ database schema${acceptDataLoss ? " (accept-data-loss for restored/replicated SQLite)" : " (non-destructive)"}`);
run(dbPush);
run(["--filter", "@uc/db", "exec", "prisma", "generate"]);
if (!process.argv.includes("--no-build") || !existsSync(path.join(ROOT, "apps/web/.next/BUILD_ID"))) {
  console.log("▸ building the web app");
  run(["--filter", "@uc/web", "build"]);
}
const port = process.env.PORT || "3000";
const procs = [
  spawn("pnpm", ["--filter", "@uc/web", "exec", "next", "start", "-p", port], { cwd: ROOT, stdio: "inherit", env: process.env }),
  spawn("pnpm", ["--filter", "@uc/settlement", "start"], { cwd: ROOT, stdio: "inherit", env: process.env }),
];
console.log(`▸ web on :${port}, settlement worker running. Public URL ${process.env.PUBLIC_URL}`);
const stop = () => procs.forEach((p) => p.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
procs.forEach((p) =>
  p.on("exit", (code) => {
    stop();
    process.exitCode = code ?? 0;
  }),
);
