import { listTokens } from "@uc/core";
import { handle } from "@/lib/api";

export function GET() {
  return handle(async () => ({ tokens: await listTokens() }));
}
