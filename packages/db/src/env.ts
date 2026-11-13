import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** The repo root (the folder with pnpm-workspace.yaml), searched upwards from the working directory. */
export function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2]!.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]!] = v;
  }
  return out;
}

let loaded = false;

/**
 * Load configuration into `process.env` once, never overriding variables that are already set:
 *   1. the repo-root `.env` (live / testnet deployments; written by `pnpm deploy:mainnet`)
 *   2. `.uc/runtime.json` (written by `pnpm demo` for the local sandbox)
 * Both the web app and the settlement worker call this before touching the database or chain.
 */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  const root = repoRoot();
  const sources: Record<string, string>[] = [];
  try {
    const f = path.join(root, ".env");
    if (existsSync(f)) sources.push(parseDotenv(readFileSync(f, "utf8")));
  } catch {
    /* unreadable .env: ignore */
  }
  try {
    const f = path.join(root, ".uc", "runtime.json");
    if (existsSync(f)) sources.push(JSON.parse(readFileSync(f, "utf8")) as Record<string, string>);
  } catch {
    /* ignore */
  }
  for (const src of sources) for (const [k, v] of Object.entries(src)) if (process.env[k] === undefined) process.env[k] = String(v);
  // Relative SQLite paths are resolved from the repo root, whichever process opens them.
  const url = process.env.DATABASE_URL;
  if (url?.startsWith("file:./") || url?.startsWith("file:.uc")) process.env.DATABASE_URL = `file:${path.resolve(root, url.slice(5))}`;
}
