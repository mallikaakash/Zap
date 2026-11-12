import { parseAuth, postMessage } from "@uc/core";
import { body, handle, type Ctx } from "@/lib/api";

/** Customer reply in the refund chat. Body: `{ text, imageName?, sig }` (sig over action "message", sha256(text)) or `{ ..., owner }`. */
export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const b = await body(req);
    return postMessage((await params).id, { text: String(b.text ?? ""), imageName: typeof b.imageName === "string" ? b.imageName : undefined, auth: parseAuth(b) });
  });
}
