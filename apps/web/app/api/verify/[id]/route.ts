import { verifyView } from "@uc/core";
import { handle, preflight, type Ctx } from "@/lib/api";

export const OPTIONS = preflight;

/** Public: lets anyone check a receipt's attribution and where its refunds went. */
export function GET(_req: Request, { params }: Ctx) {
  return handle(async () => verifyView((await params).id));
}
