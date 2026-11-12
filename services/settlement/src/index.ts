/**
 * Settlement worker: the only process that holds the executor key.
 * Confirms payments → mints receipts, runs due releases, executes approved refunds, delivers webhooks.
 */
import { getConfig, tickAll } from "@uc/core";

const INTERVAL_MS = Number(process.env.UC_WORKER_INTERVAL_MS) || 1500;
const log = (m: string) => console.log(`[settlement ${new Date().toISOString().slice(11, 19)}] ${m}`);

const c = getConfig();
log(`mode=${c.mode} network=${c.networkId} receipts=${c.receipts} executor=${c.executor}`);

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
