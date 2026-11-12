import { UcError } from "./errors";

/** USDC has 6 decimal places; all money on the wire is integer minor units. */
export const USDC_DECIMALS = 6;
const UNIT = 1_000_000n;
const USD_RE = /^(\d{1,15})(?:\.(\d{1,6}))?$/;
const MINOR_RE = /^\d{1,30}$/;

/**
 * "49" -> "49000000", "49.99" -> "49990000", "0.000001" -> "1".
 * Pure string/BigInt math. Throws on anything that is not a plain non-negative
 * decimal with at most 6 fraction digits (no signs, exponents, commas or "$").
 */
export function usdToMinor(usd: string): string {
  const m = typeof usd === "string" ? USD_RE.exec(usd.trim()) : null;
  if (!m) {
    throw new UcError(
      "invalid_config",
      `Invalid USD amount ${JSON.stringify(usd)}: expected a decimal string like "49" or "49.99" (max 6 decimal places)`,
    );
  }
  const whole = m[1] ?? "0";
  const frac = (m[2] ?? "").padEnd(USDC_DECIMALS, "0");
  return (BigInt(whole) * UNIT + BigInt(frac)).toString();
}

/**
 * "49000000" -> "49", "49990000" -> "49.99", "49500000" -> "49.50", "1" -> "0.000001".
 * Whole amounts have no fraction; otherwise at least 2 and at most 6 decimals.
 */
export function minorToUsd(minor: string | bigint): string {
  const s = typeof minor === "bigint" ? minor.toString() : minor;
  if (typeof s !== "string" || !MINOR_RE.test(s)) {
    throw new UcError(
      "invalid_config",
      `Invalid minor-unit amount ${JSON.stringify(String(minor))}: expected a non-negative integer string`,
    );
  }
  const v = BigInt(s);
  const whole = (v / UNIT).toString();
  const rem = v % UNIT;
  if (rem === 0n) return whole;
  const frac = rem.toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return `${whole}.${frac.padEnd(2, "0")}`;
}
