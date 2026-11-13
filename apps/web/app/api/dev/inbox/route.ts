import { getConfig } from "@uc/core";
import { db } from "@uc/db";
import { json } from "@/lib/api";

/** Local demo only: every email the app would have sent. */
export async function GET() {
  if (getConfig().mode === "live") return json({ error: "Not available in live mode" }, 404);
  const rows = await db.email.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  return json({ emails: rows.map((e) => ({ id: e.id, to: e.to, subject: e.subject, text: e.text, status: e.status, createdAt: e.createdAt.toISOString() })) });
}
