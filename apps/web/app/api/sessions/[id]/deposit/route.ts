import { sessionView, submitDeposit } from "@uc/core";
import { body, handle, type Ctx } from "@/lib/api";

/** The customer's wallet broadcast the deposit. Body: `{ txHash }`. */
export function POST(req: Request, { params }: Ctx) {
  return handle(async () => sessionView(await submitDeposit((await params).id, String((await body(req)).txHash ?? ""))));
}
