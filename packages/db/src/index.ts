import { PrismaClient } from "@prisma/client";
import { loadEnv } from "./env";

loadEnv();

export * from "@prisma/client";
export { loadEnv, repoRoot } from "./env";

const globalForPrisma = globalThis as unknown as { __ucPrisma?: PrismaClient };

/** One client per process (survives Next.js dev hot reloads). */
export const db: PrismaClient = globalForPrisma.__ucPrisma ?? new PrismaClient();
globalForPrisma.__ucPrisma = db;

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const row = await db.kv.findUnique({ where: { key } });
  return row ? (JSON.parse(row.value) as T) : undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value);
  await db.kv.upsert({ where: { key }, create: { key, value: json }, update: { value: json } });
}
