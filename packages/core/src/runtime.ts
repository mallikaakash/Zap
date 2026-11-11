import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Chain, generateKey } from "@uc/chain";
import { db, kvGet, kvSet } from "@uc/db";
import { createAdapter, isMockAdapter, parseMode, type IntentsAdapter, type MockAdapter, type MockRecord, type UcMode } from "@uc/intents-adapter";

export interface Config {
  mode: UcMode;
  publicUrl: string;
  rpcUrl: string;
  networkId: string;
  receipts: string;
  usdc: string;
  /** Signs mint / execute_refund / release. Used by the settlement worker only. */
  executor: string;
  /** Signs relayed customer calls and creates demo accounts. Used by the web app only. */
  relayer: string;
  /** Parent for demo-custodial accounts (`<name>.<accountParent>`). */
  accountParent: string;
}

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

/** `pnpm demo` writes the sandbox addresses and throwaway keys to `.uc/runtime.json`; env vars win over it. */
function runtimeFile(): Record<string, string> {
  try {
    const file = path.join(repoRoot(), ".uc", "runtime.json");
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

let cached: { config: Config; env: Record<string, string | undefined> } | undefined;

export function env(): Record<string, string | undefined> {
  if (!cached) getConfig();
  return cached!.env;
}

export function getConfig(): Config {
  if (cached) return cached.config;
  const e: Record<string, string | undefined> = { ...runtimeFile(), ...process.env };
  const mode = parseMode(e.UC_MODE);
  const need = (k: string): string => {
    const v = e[k];
    if (!v) throw new Error(`${k} is not set. Run \`pnpm demo\` for a local sandbox, or see .env.example.`);
    return v;
  };
  const executor = need("UC_EXECUTOR_ACCOUNT");
  const relayer = e.UC_RELAYER_ACCOUNT || executor;
  const config: Config = {
    mode,
    publicUrl: (e.PUBLIC_URL || "http://localhost:3000").replace(/\/$/, ""),
    rpcUrl: need("NEAR_RPC_URL"),
    networkId: need("NEAR_NETWORK_ID"),
    receipts: need("UC_RECEIPTS_CONTRACT"),
    usdc: need("UC_USDC_CONTRACT"),
    executor,
    relayer,
    accountParent: e.UC_ACCOUNT_PARENT || relayer,
  };
  cached = { config, env: e };
  return config;
}

const g = globalThis as unknown as { __ucChain?: Chain; __ucAdapter?: IntentsAdapter };

export function getChain(): Chain {
  if (g.__ucChain) return g.__ucChain;
  const c = getConfig();
  const e = env();
  const keys: Record<string, string> = {};
  if (e.UC_EXECUTOR_KEY) keys[c.executor] = e.UC_EXECUTOR_KEY;
  if (e.UC_RELAYER_KEY) keys[c.relayer] = e.UC_RELAYER_KEY;
  g.__ucChain = new Chain({ rpcUrl: c.rpcUrl, networkId: c.networkId, receipts: c.receipts, usdc: c.usdc, keys });
  return g.__ucChain;
}

/** True where the app may hold demo keys for merchants/customers (never on mainnet). */
export function custodialAllowed(): boolean {
  return getConfig().mode !== "live";
}

/** Make sure this process can sign for a demo-custodial account. */
export async function ensureSigner(accountId: string): Promise<boolean> {
  const chain = getChain();
  if (chain.canSignFor(accountId)) return true;
  const key = await kvGet<string>(`key:${accountId}`);
  if (!key) return false;
  await chain.addKey(accountId, key);
  return true;
}

/** Turn a display name into `<slug>.<parent>`, creating the account (demo-custodial) if needed. */
export async function ensureDemoAccount(name: string): Promise<string> {
  if (!custodialAllowed()) throw new Error("Demo accounts are not available in live mode");
  const c = getConfig();
  const chain = getChain();
  const slug = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  if (slug.length < 2) throw new Error("Pick a name with at least 2 letters or digits");
  const accountId = name.endsWith(`.${c.accountParent}`) ? name : `${slug}.${c.accountParent}`;
  if (await ensureSigner(accountId)) return accountId;
  if (await chain.accountExists(accountId)) throw new Error(`${accountId} already exists and is not managed by this demo`);
  const key = generateKey();
  await chain.createSubAccount(c.accountParent, accountId, key.publicKey.toString(), key.secretKey);
  await kvSet(`key:${accountId}`, key.secretKey);
  return accountId;
}

export function getAdapter(): IntentsAdapter {
  if (g.__ucAdapter) return g.__ucAdapter;
  const c = getConfig();
  g.__ucAdapter = createAdapter(env() as never, {
    mock: {
      // Shared between the web app and the worker through the database.
      store: {
        get: (addr: string) => kvGet<MockRecord>(`mock:${addr}`),
        put: (rec: MockRecord) => kvSet(`mock:${rec.quote.depositAddress}`, rec),
      },
      seed: `${c.receipts}:${process.pid}:${Date.now()}`,
      // "Delivery" of a simulated payment: mint mock USDC to the receipt contract.
      onDeliver: async ({ recipientNear, amountOut }) => {
        const chain = getChain();
        await chain.mintMockUsdc(chain.canSignFor(c.relayer) ? c.relayer : c.executor, recipientNear, amountOut);
      },
      onRefundDelivered: async ({ quote, targetAsset, targetAddress, amountOut }) => {
        await db.chainEvent.create({
          data: { event: "mock_refund_delivered", dataJson: JSON.stringify({ depositAddress: quote.depositAddress, targetAsset, targetAddress, amountOut }) },
        });
      },
    },
  });
  return g.__ucAdapter;
}

export function getMockAdapter(): MockAdapter | undefined {
  const a = getAdapter();
  return isMockAdapter(a) ? a : undefined;
}

/** Simulated swaps are available everywhere except live mode. */
export function simulationAllowed(): boolean {
  return getConfig().mode !== "live" && !!getMockAdapter();
}
