/**
 * `pnpm demo` — the whole product on your machine, no keys, no accounts, no real money.
 *
 *   1. starts a local NEAR sandbox
 *   2. deploys the prebuilt mock USDC and receipt contracts
 *   3. seeds a demo merchant (a SaaS business) with three products
 *   4. starts the web app and the settlement worker
 *
 * Everything it creates is throwaway: the chain lives in a temp dir and the keys it
 * generates exist only for this run (written to the git-ignored `.uc/runtime.json`).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateKey, Near } from "near-kit";
import { Sandbox } from "near-kit/sandbox";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UC = path.join(ROOT, ".uc");
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const SETUP_ONLY = process.argv.includes("--setup-only"); // used by the smoke test

const step = (m: string) => console.log(`\n\x1b[1m▸ ${m}\x1b[0m`);
const info = (m: string) => console.log(`  ${m}`);
function fail(message: string, hint?: string): never {
  console.error(`\n\x1b[31m✖ ${message}\x1b[0m${hint ? `\n  ${hint}` : ""}\n`);
  process.exit(1);
}

const children: ChildProcess[] = [];
let sandbox: Sandbox | undefined;
let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  console.log("\nStopping…");
  for (const c of children) c.kill("SIGTERM");
  await sandbox?.stop().catch(() => {});
  process.exit(code);
}
process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

function wasm(name: string): Uint8Array {
  const file = path.join(ROOT, "contracts", "artifacts", name);
  if (!existsSync(file)) fail(`Missing ${path.relative(ROOT, file)}`, "The prebuilt contracts should be in the repo. Rebuild them with `pnpm build:contracts` (needs Rust + cargo-near).");
  return new Uint8Array(readFileSync(file));
}

async function main() {
  const [major] = process.versions.node.split(".").map(Number);
  if ((major ?? 0) < 22) fail(`Node ${process.versions.node} is too old`, "Zap needs Node 22 or newer (`nvm use`).");

  const receiptsWasm = wasm("receipts.wasm");
  const usdcWasm = wasm("mock_usdc.wasm");

  step("Preparing the database");
  mkdirSync(UC, { recursive: true });
  const dbFile = path.join(UC, "demo.db");
  for (const f of [dbFile, `${dbFile}-journal`]) rmSync(f, { force: true });
  const DATABASE_URL = `file:${dbFile}`;
  const prisma = spawnSync("pnpm", ["--filter", "@uc/db", "exec", "prisma", "db", "push", "--skip-generate", "--accept-data-loss"], { cwd: ROOT, env: { ...process.env, DATABASE_URL }, encoding: "utf8" });
  const gen = spawnSync("pnpm", ["--filter", "@uc/db", "exec", "prisma", "generate"], { cwd: ROOT, env: { ...process.env, DATABASE_URL }, encoding: "utf8" });
  if (prisma.status !== 0 || gen.status !== 0) fail("Could not set up the SQLite database", (prisma.stderr || gen.stderr || prisma.stdout || "").trim().split("\n").slice(-6).join("\n  "));
  info(`SQLite at ${path.relative(ROOT, dbFile)}`);

  step("Starting a local NEAR sandbox");
  info("The first run downloads the sandbox binary (about 60 MB); later runs start in seconds.");
  try {
    sandbox = await Sandbox.start();
  } catch (e) {
    fail(
      "The local NEAR sandbox could not start",
      `${e instanceof Error ? e.message : String(e)}\n  It needs to download a binary from near's build server on first run, and supports macOS and Linux (x64/arm64).\n  If you are offline or on an unsupported platform, set NEAR_SANDBOX_BIN_PATH to a near-sandbox binary, or use the hosted demo linked in the README.`,
    );
  }
  const root = sandbox.rootAccount;
  info(`RPC ${sandbox.rpcUrl} · root account ${root.id}`);

  step("Deploying contracts");
  const near = new Near({ network: sandbox });
  const usdc = `usdc.${root.id}`;
  const receipts = `receipts.${root.id}`;
  const executor = `executor.${root.id}`;
  const executorKey = generateKey();
  await near.transaction(root.id).createAccount(usdc).transfer(usdc, "20 NEAR").deployContract(usdc, usdcWasm).functionCall(usdc, "new", {}, { gas: "30 Tgas" }).send();
  info(`mock USDC      ${usdc}`);
  await near
    .transaction(root.id)
    .createAccount(executor)
    .transfer(executor, "50 NEAR")
    .addKey(executorKey.publicKey.toString(), { type: "fullAccess" })
    .send();
  await near
    .transaction(root.id)
    .createAccount(receipts)
    .transfer(receipts, "50 NEAR")
    .deployContract(receipts, receiptsWasm)
    .functionCall(receipts, "new", { usdc, executor, owner: root.id }, { gas: "30 Tgas" })
    .send();
  info(`receipts       ${receipts}`);
  info(`executor       ${executor}  (settlement worker)`);
  // The receipt contract must be able to hold USDC.
  await near.call(usdc, "storage_deposit", { account_id: receipts, registration_only: true }, { signerId: root.id, attachedDeposit: "0.01 NEAR", gas: "30 Tgas" });

  const runtime: Record<string, string> = {
    UC_MODE: "local",
    PUBLIC_URL,
    DATABASE_URL,
    NEAR_RPC_URL: sandbox.rpcUrl,
    NEAR_NETWORK_ID: sandbox.networkId,
    UC_RECEIPTS_CONTRACT: receipts,
    UC_USDC_CONTRACT: usdc,
    UC_EXECUTOR_ACCOUNT: executor,
    UC_EXECUTOR_KEY: executorKey.secretKey,
    UC_RELAYER_ACCOUNT: root.id,
    UC_RELAYER_KEY: root.secretKey,
    UC_ACCOUNT_PARENT: root.id,
    // Demo clock: 30 days of schedule time pass in one minute (never applied in live mode).
    UC_TIME_SCALE: process.env.UC_TIME_SCALE || "43200",
  };
  writeFileSync(path.join(UC, "runtime.json"), JSON.stringify(runtime, null, 2));
  Object.assign(process.env, runtime);

  step("Seeding the demo merchant");
  const { registerMerchant, tickMerchants, dashboardUrl } = await import("@uc/core");
  const { db } = await import("@uc/db");
  // Same path a real merchant takes: sign up with a payout account; the worker registers it on chain.
  const shop = await registerMerchant({
    name: "Tallyfox",
    email: "billing@tallyfox.local",
    guardThreshold: "50000000", // $50: above this, refunds always go to the merchant
    autoApproveMax: "20000000", // $20: the refund assistant may approve up to this
    defaultWindowSecs: 300, // 5-minute refund window so the whole flow fits in a demo
    responseSecs: 300, // merchant has 5 minutes to answer; silence = approve
    vetoSecs: 30, // merchant may object to an AI approval for 30 seconds
    minOrder: "1000000",
    webhookUrl: `${PUBLIC_URL}/api/dev/webhook-sink?merchant=tallyfox.${root.id}`,
  });
  await tickMerchants(executor, (m) => info(m));
  await db.product.createMany({
    data: [
      { merchantId: shop.id, name: "Pro plan · 1 year", emoji: "📈", description: "Unlimited dashboards and exports for a year. Paid once, held in escrow for a 5-minute refund window.", amount: "18000000", kind: "OneTime", windowSecs: 300 },
      { merchantId: shop.id, name: "Team plan · prepaid", emoji: "👥", description: "Prepaid plan: 3 billing periods, one released to Tallyfox every 3 minutes. Cancel and the unused periods come back. The plan pass is transferable.", amount: "36000000", kind: "Subscription", scheduleJson: JSON.stringify([0, 1, 2].map((i) => ({ afterSecs: i * 180, amount: "12000000" }))) },
      { merchantId: shop.id, name: "Onboarding & integration", emoji: "🛠️", description: "A setup project paid in three milestones that release over time: kickoff, integration, launch.", amount: "120000000", kind: "Schedule", scheduleJson: JSON.stringify([{ afterSecs: 0, amount: "30000000" }, { afterSecs: 240, amount: "50000000" }, { afterSecs: 480, amount: "40000000" }]) },
    ],
  });
  const fresh = await db.merchant.findUniqueOrThrow({ where: { id: shop.id } });
  if (fresh.chainState !== "active") fail("The demo merchant could not be registered on the contract", fresh.chainError ?? "");
  const DASHBOARD = dashboardUrl(fresh);
  info(`${shop.name} registered on chain as ${shop.id}`);
  await db.$disconnect();

  if (SETUP_ONLY) {
    console.log("\nSetup complete (--setup-only). Sandbox stays up until this process exits.");
    console.log(JSON.stringify({ rpcUrl: sandbox.rpcUrl, receipts, usdc, merchant: shop.id, dashboard: DASHBOARD }));
    return;
  }

  step("Starting the web app and the settlement worker");
  const run = (name: string, args: string[], extraEnv: Record<string, string> = {}) => {
    const child = spawn("pnpm", args, { cwd: ROOT, env: { ...process.env, ...runtime, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
    const tag = `\x1b[2m[${name}]\x1b[0m `;
    const pipe = (buf: Buffer) => buf.toString().split("\n").filter((l) => l.trim()).forEach((l) => console.log(tag + l));
    child.stdout?.on("data", pipe);
    child.stderr?.on("data", pipe);
    child.on("exit", (code) => {
      if (!stopping) {
        console.error(`\n${name} stopped unexpectedly (exit ${code}).`);
        void shutdown(1);
      }
    });
    children.push(child);
  };
  run("web", ["--filter", "@uc/web", "dev"], { PORT: String(PORT) });
  run("worker", ["--filter", "@uc/settlement", "start"]);

  // Wait for the web app to answer before printing the links.
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      if ((await fetch(`${PUBLIC_URL}/api/dev/state`, { signal: AbortSignal.timeout(4000) })).ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) fail("The web app did not come up within two minutes", `Check the [web] lines above. Is port ${PORT} already in use? Try PORT=3100 pnpm demo.`);
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log(`
\x1b[1m\x1b[32m✔ Zap is running (local sandbox, no real money)\x1b[0m

  Start here        ${PUBLIC_URL}
  Demo checkout     ${PUBLIC_URL}/shop
  Merchant dashboard ${DASHBOARD}
  Dev inbox (emails) ${PUBLIC_URL}/dev/inbox

  Try: buy a plan on the demo checkout → "Simulate payment" → open the receipt →
  request a refund → answer the assistant → watch the money go back.

  Press Ctrl+C to stop.
`);
}

main().catch((e) => {
  console.error(e);
  void shutdown(1);
});
