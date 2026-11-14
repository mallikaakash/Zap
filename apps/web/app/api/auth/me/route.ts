import { merchantBySession } from "@uc/core";
import { handle, sessionOf } from "@/lib/api";

/** Which shop this browser is logged in to (session cookie only), or null. */
export function GET(req: Request) {
  return handle(async () => {
    const m = await merchantBySession(sessionOf(req));
    return { merchant: m ? { id: m.id, name: m.name, hasPassword: !!m.passwordHash } : null };
  });
}
