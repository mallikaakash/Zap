import { getChain, getConfig, UserError } from "@uc/core";
import { body, handle } from "@/lib/api";

/** Local sandbox only: jump chain time forward so refund windows and tranches can be shown without waiting. */
export function POST(req: Request) {
  return handle(async () => {
    if (getConfig().networkId !== "localnet") throw new UserError("Time travel only works on the local sandbox", 403);
    const seconds = Number((await body(req)).seconds);
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3600) throw new UserError("seconds must be between 1 and 3600");
    await getChain().fastForward(Math.floor(seconds));
    return { chainNow: (await getChain().now()).toISOString() };
  });
}
