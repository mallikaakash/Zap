import { transferReceipt } from "@uc/core";
import { body, handle, type Ctx } from "@/lib/api";

/** Hand a pass to someone else (standard NEP-171 transfer). Body: `{ owner, to }`. Demo accounts only; real owners use their wallet. */
export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const b = await body(req);
    return transferReceipt((await params).id, String(b.owner ?? ""), String(b.to ?? ""));
  });
}
