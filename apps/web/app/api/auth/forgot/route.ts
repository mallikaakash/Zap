import { sendSignInLink } from "@uc/core";
import { body, clientKey, handle } from "@/lib/api";

/** Body: `{ merchant }`. Emails a sign-in link to the shop's saved address. Same answer whether or not the shop exists. */
export function POST(req: Request) {
  return handle(async () => {
    await sendSignInLink((await body(req)).merchant, clientKey(req));
    return { ok: true };
  });
}
