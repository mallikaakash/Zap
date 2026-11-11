const UINT_RE = /^(0|[1-9][0-9]*)$/;

/** Parses a positive integer minor-unit string; throws a readable error otherwise. */
export function parseAmount(value: unknown, name: string): bigint {
  if (typeof value !== 'string' || !UINT_RE.test(value)) {
    throw new Error(`${name} must be an integer string in minor units (e.g. "49000000" for 49 USDC), got ${JSON.stringify(value)}`);
  }
  const n = BigInt(value);
  if (n <= 0n) throw new Error(`${name} must be greater than zero`);
  return n;
}

export function isUintString(value: unknown): value is string {
  return typeof value === 'string' && UINT_RE.test(value);
}

/** "84.63" with scale 8 -> 8463000000n. Extra fractional digits are truncated. */
export function parseDecimal(value: string, scale: number): bigint {
  const m = /^([0-9]+)(?:\.([0-9]+))?$/.exec(value.trim());
  if (!m) throw new Error(`not a plain decimal number: ${JSON.stringify(value)}`);
  const frac = (m[2] ?? '').slice(0, scale).padEnd(scale, '0');
  return BigInt((m[1] ?? '0') + frac);
}

/** JSON number -> plain decimal string (no exponent). Used for prices only, never for amounts. */
export function numberToDecimalString(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  return n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 18 });
}

export function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

export function deadlineFromNow(nowMs: number, mins: number | undefined, fallbackMins: number): string {
  const m = mins ?? fallbackMins;
  if (!Number.isFinite(m) || m <= 0) throw new Error(`deadlineMins must be a positive number, got ${String(mins)}`);
  return new Date(nowMs + Math.round(m * 60_000)).toISOString();
}

/** Deterministic pseudo-random bytes from a string (xmur3 + mulberry32). NOT cryptographic. */
export function seededBytes(input: string, count: number): number[] {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  let a = (h ^ (h >>> 16)) >>> 0;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    out.push(((t ^ (t >>> 14)) >>> 0) & 0xff);
  }
  return out;
}

export function pick(alphabet: string, bytes: number[]): string {
  return bytes.map((b) => alphabet[b % alphabet.length]).join('');
}
