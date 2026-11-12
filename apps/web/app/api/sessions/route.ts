import { checkoutUrl, createSession } from "@uc/core";
import { body, handle, preflight } from "@/lib/api";

export const OPTIONS = preflight;

/** Create a payment session. Called by the pay button, plugins and the MCP server. */
export function POST(req: Request) {
  return handle(async () => {
    const b = await body(req);
    const s = await createSession(b as never);
    return { sessionId: s.id, checkoutUrl: checkoutUrl(s.id), orderRef: s.orderRef };
  });
}
