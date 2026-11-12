/**
 * `pnpm dev` — web app + settlement worker against the configured mode.
 * Reads addresses from the environment (see .env.example) or, failing that, from the
 * `.uc/runtime.json` a previous `pnpm demo` wrote. For a fresh local chain use `pnpm demo`.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const procs = [
  spawn("pnpm", ["--filter", "@uc/web", "dev"], { cwd: ROOT, stdio: "inherit" }),
  spawn("pnpm", ["--filter", "@uc/settlement", "start"], { cwd: ROOT, stdio: "inherit" }),
];
const stop = () => procs.forEach((p) => p.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
procs.forEach((p) => p.on("exit", (code) => { stop(); process.exitCode = code ?? 0; }));
