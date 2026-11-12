import { getChain, getConfig, simulationAllowed, timeScale } from "@uc/core";
import { handle } from "@/lib/api";

/** Mode and chain clock, for the UI's "demo" affordances. */
export function GET() {
  return handle(async () => {
    const c = getConfig();
    return { mode: c.mode, networkId: c.networkId, receipts: c.receipts, usdc: c.usdc, chainNow: (await getChain().now()).toISOString(), canSimulate: simulationAllowed(), canTimeTravel: c.networkId === "localnet", timeScale: timeScale() };
  });
}
