import { handle, withSession } from "@/lib/api";

export async function POST() {
  return withSession(await handle(async () => ({ ok: true })), null);
}
