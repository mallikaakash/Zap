import { emailReceiptLink } from "@uc/core";
import { body, handle, type Ctx } from "@/lib/api";

/** Customer asks for their receipt link by email. Body: `{ email, link }`. */
export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const b = await body(req);
    return emailReceiptLink((await params).id, String(b.email ?? ""), String(b.link ?? ""));
  });
}
