/**
 * Rotating one-time receipt secrets (see DECISIONS.md). Isomorphic: uses WebCrypto,
 * so the same code runs in the customer's browser and in Node.
 *
 * master   : 32 random bytes, hex — lives only in the receipt URL fragment
 * secret_n : sha256(utf8(`${masterHex}:${n}`)), hex (32 bytes) — revealed on use
 * hash_n   : sha256(bytes(secret_n)), hex — what the contract stores
 *
 * The contract stores hash_n and its `secret_nonce` n. A call reveals secret_n and
 * supplies hash_{n+1}; once it lands, secret_n is useless.
 */

const enc = new TextEncoder();

export function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function fromHex(hex: string): Uint8Array {
  if (!/^([0-9a-f]{2})*$/i.test(hex)) throw new Error("Invalid hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data as BufferSource));
}

export function newMasterSecret(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

export function isMasterSecret(s: unknown): s is string {
  return typeof s === "string" && /^[0-9a-f]{64}$/.test(s);
}

export async function deriveSecret(masterHex: string, nonce: number): Promise<string> {
  return toHex(await sha256(enc.encode(`${masterHex}:${nonce}`)));
}

export async function hashSecret(secretHex: string): Promise<string> {
  return toHex(await sha256(fromHex(secretHex)));
}

/** Hash to give the contract at mint time (nonce 0). */
export async function initialSecretHash(masterHex: string): Promise<string> {
  return hashSecret(await deriveSecret(masterHex, 0));
}

/** What a secret-authorised call needs: the current secret and the hash that replaces it. */
export async function secretStep(masterHex: string, nonce: number): Promise<{ secret: string; nextSecretHash: string }> {
  return {
    secret: await deriveSecret(masterHex, nonce),
    nextSecretHash: await hashSecret(await deriveSecret(masterHex, nonce + 1)),
  };
}
