import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

/** Server-only: gzip size of the first pay.js found, so the page states a measured number. */
export function payJsGzipBytes(candidates: string[]): number | undefined {
  for (const p of candidates) {
    if (existsSync(p)) return gzipSync(readFileSync(p), { level: 9 }).length;
  }
  return undefined;
}
