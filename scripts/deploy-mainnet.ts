/**
 * `pnpm deploy:mainnet` — set up Universal Checkout on NEAR mainnet. RUN BY THE OPERATOR ONLY.
 *
 * What it does (idempotent; re-running skips what already exists):
 *   1. creates  checkout.<operator>  (receipt contract),  executor.<operator>  (settlement worker),
 *      relayer.<operator>  (web app) as sub-accounts, each with a NEW key saved to
 *      ~/.near-credentials/<network>/<account>.json  (file mode 600)
 *   2. deploys contracts/artifacts/receipts.wasm to checkout.<operator> and initialises it
 *      with real USDC, the executor, and the operator as owner
 *   3. registers the contract with the USDC token so it can hold USDC, sets the per-payment cap
 *   4. writes the repo-root .env (mode 600) with everything the app needs for live mode
 *
 * The operator key is read from ~/.near-credentials/<network>/<operator>.json (near-cli
 * "legacy keychain" format). This script never prints a private key.
 *
 *   pnpm deploy:mainnet --operator aakash7777.near --public-url https://1-2-3-4.sslip.io            # plan only
 *   pnpm deploy:mainnet --operator aakash7777.near --public-url https://1-2-3-4.sslip.io --yes      # do it
 *
 * Rehearse on the local sandbox first (no real money):
 *   pnpm deploy:mainnet --operator test.near --rpc http://127.0.0.1:PORT --network-id localnet \
 *     --usdc usdc.test.near --credentials .uc/creds --public-url http://localhost:3000 --yes --env-file .uc/rehearsal.env
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileKeyStore } from "near-kit/keys/file";
import { generateKey, Near } from "near-kit";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAINNET_USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
function die(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

const operator = arg("operator") ?? die("Pass --operator <your-account.near>");
const networkId = arg("network-id", "mainnet")!;
const rpcUrl = arg("rpc", networkId === "mainnet" ? "https://rpc.mainnet.fastnear.com" : networkId === "testnet" ? "https://rpc.testnet.fastnear.com" : undefined) ?? die("Pass --rpc for a custom network");
const usdc = arg("usdc", networkId === "mainnet" ? MAINNET_USDC : undefined) ?? die("Pass --usdc <token account> outside mainnet");
const publicUrl = (arg("public-url") ?? die("Pass --public-url https://<your-host> (HTTPS is required in browsers for receipt keys)")).replace(/\/$/, "");
const credsDir = path.resolve(arg("credentials", path.join(os.homedir(), ".near-credentials"))!.replace(/^~/, os.homedir()));
const envFile = path.resolve(ROOT, arg("env-file", ".env")!);
const maxUsd = Number(arg("max-usd", "50"));
const go = flag("yes");

const contract = `checkout.${operator}`;
const executor = `executor.${operator}`;
const relayer = `relayer.${operator}`;
const wasmPath = path.join(ROOT, "contracts", "artifacts", "receipts.wasm");

const yocto = (near: number) => BigInt(Math.round(near * 1e6)) * 10n ** 18n;
const fmt = (y: bigint) => `${(Number(y / 10n ** 18n) / 1e6).toFixed(4)} NEAR`;

async function main() {
  if (!existsSync(wasmPath)) die(`Missing ${wasmPath}. Run pnpm build:contracts.`);
  const wasm = new Uint8Array(readFileSync(wasmPath));
  if (!/^https:\/\//.test(publicUrl) && networkId === "mainnet") die("--public-url must be https:// for mainnet (browsers only allow receipt keys and wallets on HTTPS pages).");

  const keyStore = new FileKeyStore(credsDir, networkId as never);
  const near = new Near({ network: { rpcUrl, networkId }, keyStore });
  const opKey = await keyStore.get(operator);
  if (!opKey) die(`No key for ${operator} in ${credsDir}/${networkId}/. Import it with near-cli-rs (choose "save to legacy keychain"), see the README.`);

  // Storage staking: 1e19 yocto per byte. Code + state margin for the contract; working balances for the signers.
  const codeStake = BigInt(wasm.length) * 10n ** 19n;
  const plan = [
    { account: contract, fund: codeStake + yocto(1.0), why: `contract code ${Math.round(wasm.length / 1024)} KB (${fmt(codeStake)} locked) + state` },
    { account: executor, fund: yocto(1.5), why: "gas, USDC registrations, prepaid receipt storage for sellers (0.014 NEAR per receipt)" },
    { account: relayer, fund: yocto(0.3), why: "gas for relayed customer actions" },
  ];
  const opBalance = BigInt((await near.rpc.getAccount(operator).catch(() => die(`${operator} does not exist on ${networkId}`))).amount);
  const exists = Object.fromEntries(await Promise.all(plan.map(async (p) => [p.account, await near.accountExists(p.account)] as const)));
  const needed = plan.filter((p) => !exists[p.account]).reduce((a, p) => a + p.fund, 0n) + yocto(0.05);

  console.log(`\nUniversal Checkout deployment on ${networkId}  (rpc ${rpcUrl})`);
  console.log(`  operator   ${operator}   balance ${fmt(opBalance)}`);
  for (const p of plan) console.log(`  ${exists[p.account] ? "exists " : "create "}  ${p.account.padEnd(36)} ${exists[p.account] ? "" : `fund ${fmt(p.fund)}`}  (${p.why})`);
  console.log(`  USDC       ${usdc}`);
  console.log(`  cap        $${maxUsd} per payment`);
  console.log(`  .env  →    ${path.relative(ROOT, envFile) || envFile}`);
  console.log(`  needs about ${fmt(needed)} from ${operator}\n`);
  if (opBalance < needed) die(`${operator} has ${fmt(opBalance)}; it needs about ${fmt(needed)}. Fund it and run again.`);
  if (!go) {
    console.log("Plan only. Re-run with --yes to execute.\n");
    return;
  }

  // 1. accounts with fresh keys
  const secrets: Record<string, string> = {};
  for (const p of plan) {
    let kp = await keyStore.get(p.account);
    if (!exists[p.account]) {
      kp = generateKey();
      await keyStore.add(p.account, kp);
      await near
        .transaction(operator)
        .createAccount(p.account)
        .transfer(p.account, p.fund as never)
        .addKey(kp.publicKey.toString(), { type: "fullAccess" } as never)
        .send();
      console.log(`  ✓ created ${p.account}`);
    }
    if (!kp) die(`${p.account} exists but its key is not in ${credsDir}/${networkId}/`);
    const file = path.join(credsDir, networkId, `${p.account}.json`);
    if (existsSync(file)) chmodSync(file, 0o600);
    secrets[p.account] = kp.secretKey;
  }

  // 2. deploy + init (skip init if already initialised)
  const initialised = await near.view(contract, "get_config", {}).then(() => true, () => false);
  if (!initialised) {
    await near.transaction(contract).deployContract(contract, wasm).functionCall(contract, "new", { usdc, executor, owner: operator }, { gas: "50 Tgas" as never }).send();
    console.log(`  ✓ deployed and initialised ${contract}`);
  } else {
    console.log(`  · ${contract} already initialised (not redeployed)`);
  }

  // 3. USDC registration for the contract, and the per-payment cap
  const reg = await near.view(usdc, "storage_balance_of", { account_id: contract });
  if (!reg) {
    await near.call(usdc, "storage_deposit", { account_id: contract, registration_only: true }, { signerId: operator, attachedDeposit: "0.00125 NEAR" as never, gas: "30 Tgas" as never });
    console.log(`  ✓ registered ${contract} with USDC`);
  }
  await near
    .call(contract, "set_max_receipt_amount", { amount: String(BigInt(Math.round(maxUsd * 1e6))) }, { signerId: operator, gas: "30 Tgas" as never })
    .then(() => console.log(`  ✓ cap set to $${maxUsd} per payment`))
    .catch((e: unknown) => console.log(`  ! could not set the cap (${e instanceof Error ? e.message : e}); the contract default applies`));

  // 4. .env for the app (never committed; mode 600)
  const env = {
    UC_MODE: networkId === "mainnet" ? "live" : networkId === "testnet" ? "testnet" : "local",
    CONFIRM_REAL_MONEY: networkId === "mainnet" ? "yes" : "",
    PUBLIC_URL: publicUrl,
    DATABASE_URL: "file:./.uc/live.db",
    NEAR_RPC_URL: rpcUrl,
    NEAR_NETWORK_ID: networkId,
    UC_RECEIPTS_CONTRACT: contract,
    UC_USDC_CONTRACT: usdc,
    UC_EXECUTOR_ACCOUNT: executor,
    UC_EXECUTOR_KEY: secrets[executor]!,
    UC_RELAYER_ACCOUNT: relayer,
    UC_RELAYER_KEY: secrets[relayer]!,
    UC_ACCOUNT_PARENT: relayer,
  };
  let previous = "";
  if (existsSync(envFile)) {
    previous = readFileSync(envFile, "utf8")
      .split(/\r?\n/)
      .filter((l) => !Object.keys(env).some((k) => l.startsWith(`${k}=`)))
      .join("\n")
      .trim();
  }
  mkdirSync(path.dirname(envFile), { recursive: true });
  writeFileSync(envFile, `# Written by scripts/deploy-mainnet.ts — contains private keys, never commit.\n${Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n")}\n${previous ? `\n${previous}\n` : ""}`, { mode: 0o600 });
  chmodSync(envFile, 0o600);
  console.log(`  ✓ wrote ${path.relative(ROOT, envFile) || envFile} (mode ${(statSync(envFile).mode & 0o777).toString(8)})`);

  console.log(`\nDone. Next:\n  pnpm start            # builds the web app, starts it and the settlement worker\n  open ${publicUrl}/dashboard   # create a seller shop with its payout account\n`);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
