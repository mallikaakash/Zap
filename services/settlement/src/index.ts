/**
 * Settlement worker: the only process that holds the executor key.
 * Confirms payments → mints receipts, runs due releases, executes approved refunds, delivers webhooks.
 */
import { getChain, getConfig, tickAll } from "@uc/core";

const c = getConfig();
// The local sandbox ticks fast. On a public network the worker shares the RPC rate limit with the web app, so it ticks slower.
const INTERVAL_MS = Number(process.env.UC_WORKER_INTERVAL_MS) || (c.networkId === "localnet" ? 1500 : 5000);
const log = (m: string) => console.log(`[settlement ${new Date().toISOString().slice(11, 19)}] ${m}`);

log(`mode=${c.mode} network=${c.networkId} receipts=${c.receipts} executor=${c.executor} rpc=${getChain().rpcHosts.join(", ")} tick=${INTERVAL_MS}ms`);

let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

while (!stopping) {
  try {
    await tickAll(log);
  } catch (e) {
    log(`tick failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  await new Promise((r) => setTimeout(r, INTERVAL_MS));
}
log("stopped");
