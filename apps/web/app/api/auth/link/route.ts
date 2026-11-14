import { authMerchant } from "@uc/core";
import { body, handle, withSession } from "@/lib/api";

/** Body: `{ merchant, token }` from a private dashboard link or emailed sign-in link. Turns it into a session cookie. */
export async function POST(req: Request) {
  let token: string | null = null;
  const res = await handle(async () => {
    const b = await body(req);
    const m = await authMerchant(String(b.merchant ?? ""), typeof b.token === "string" ? b.token : null);
    token = m.dashboardToken;
    return { merchant: { id: m.id, name: m.name } };
  });
  return token ? withSession(res, token) : res;
}
