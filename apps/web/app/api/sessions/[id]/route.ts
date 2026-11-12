import { getSession } from "@uc/core";
import { handle, preflight, type Ctx } from "@/lib/api";

export const OPTIONS = preflight;

export function GET(_req: Request, { params }: Ctx) {
  return handle(async () => getSession((await params).id));
}
