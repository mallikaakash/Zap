import { loginMerchant } from "@uc/core";
import { body, clientKey, handle, withSession } from "@/lib/api";

/** Body: `{ merchant, password }`. Starts a 30-day session cookie. */
export async function POST(req: Request) {
  let token: string | null = null;
  const res = await handle(async () => {
    const b = await body(req);
    const m = await loginMerchant(b.merchant, b.password, clientKey(req));
    token = m.dashboardToken;
    return { merchant: { id: m.id, name: m.name } };
  });
  return token ? withSession(res, token) : res;
}
