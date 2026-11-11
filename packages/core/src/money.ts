/** Money helpers. All amounts are integer minor units (USDC, 6 dp) as decimal strings. Never floats. */

export const USDC_DECIMALS = 6;

/** "49.99" → "49990000". Throws on junk, negatives, or more than `decimals` fraction digits. */
export function toMinor(value: string, decimals = USDC_DECIMALS): string {
  const v = value.trim();
  if (!/^\d+(\.\d+)?$/.test(v)) throw new Error(`Invalid amount: "${value}"`);
  const [whole = "0", frac = ""] = v.split(".");
  if (frac.length > decimals) throw new Error(`Too many decimal places in "${value}" (max ${decimals})`);
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0")).toString();
}

/** "49990000" → "49.99" (trims trailing zeros, keeps at least `minFrac` fraction digits). */
export function fromMinor(minor: string | bigint, decimals = USDC_DECIMALS, minFrac = 2): string {
  const n = BigInt(minor);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  if (frac.length < minFrac) frac = frac.padEnd(minFrac, "0");
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${frac ? "." + frac : ""}`;
}

/** "$49.99" */
export function usd(minor: string | bigint): string {
  return `$${fromMinor(minor)}`;
}

export function isMinor(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value) && value.length <= 30;
}

export function sumMinor(values: Array<string | bigint>): string {
  return values.reduce<bigint>((a, b) => a + BigInt(b), 0n).toString();
}
