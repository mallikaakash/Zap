import { prepareClaimAccount } from "@uc/core";
import { body, handle } from "@/lib/api";

/**
 * Resolve the NEAR account a claim or transfer will go to. Given an existing account id it is returned as is;
 * given a plain name, a throwaway demo account is created (never in live mode). The browser then signs the claim for it.
 */
export function POST(req: Request) {
  return handle(async () => ({ account: await prepareClaimAccount(String((await body(req)).name ?? "")) }));
}
