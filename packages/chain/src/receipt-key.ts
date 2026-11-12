/**
 * Receipt keys (SPEC §4 "Security model" #1). Isomorphic: runs in the customer's
 * browser and in Node.
 *
 * At checkout the browser makes an ed25519 keypair. Only the PUBLIC key goes to the
 * contract. The private key lives in the receipt link's URL fragment and never reaches
 * a server. Customer actions on an unclaimed receipt are signed here and relayed.
 *
 *   preimage = utf8("uc:v1|{contract}|{receiptId}|{action}|{params}|{nonce}")
 *   sig      = ed25519_sign(privateKey, sha256(preimage))
 *
 * The signature binds the exact parameters and the receipt's nonce, so seeing it on
 * chain lets nobody reuse it for another amount, account or action.
 */
import * as ed from "@noble/ed25519";

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

export async function sha256Hex(text: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text) as BufferSource)));
}

export const isHex64 = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);
export const isSignature = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{128}$/.test(s);

/** New receipt keypair. `privateKey` goes in the receipt link fragment; `publicKey` goes on chain. */
export async function newReceiptKey(): Promise<{ privateKey: string; publicKey: string }> {
  const sk = ed.utils.randomSecretKey();
  return { privateKey: toHex(sk), publicKey: toHex(await ed.getPublicKeyAsync(sk)) };
}

export async function receiptPublicKey(privateKey: string): Promise<string> {
  return toHex(await ed.getPublicKeyAsync(fromHex(privateKey)));
}

export type ReceiptAction =
  | { action: "request_refund"; amount: string; reasonHash: string }
  | { action: "cancel"; reasonHash: string }
  | { action: "appeal" }
  | { action: "confirm_received" }
  | { action: "claim"; account: string }
  | { action: "set_refund_target"; chain: string; asset: string; address: string }
  /** Off-chain only: proves the sender of a chat message holds the receipt. Never sent to the contract. */
  | { action: "message"; bodyHash: string };

function params(a: ReceiptAction): string {
  switch (a.action) {
    case "request_refund":
      return `${a.amount}|${a.reasonHash}`;
    case "cancel":
      return a.reasonHash;
    case "message":
      return a.bodyHash;
    case "claim":
      return a.account;
    case "set_refund_target":
      return `${a.chain}|${a.asset}|${a.address}`;
    default:
      return "";
  }
}

export function actionPreimage(contract: string, receiptId: string, nonce: number, a: ReceiptAction): string {
  const fields = a.action === "claim" ? [a.account] : a.action === "set_refund_target" ? [a.chain, a.asset, a.address] : [];
  if (fields.some((f) => f.includes("|"))) throw new Error("Parameters may not contain '|'");
  const p = params(a);
  return `uc:v1|${contract}|${receiptId}|${a.action}|${p}|${nonce}`;
}

/** Sign an action with the receipt's private key. Returns the 128-hex signature the contract verifies. */
export async function signReceiptAction(privateKey: string, contract: string, receiptId: string, nonce: number, a: ReceiptAction): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(actionPreimage(contract, receiptId, nonce, a)) as BufferSource));
  return toHex(await ed.signAsync(digest, fromHex(privateKey)));
}

export async function verifyReceiptAction(publicKey: string, sig: string, contract: string, receiptId: string, nonce: number, a: ReceiptAction): Promise<boolean> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(actionPreimage(contract, receiptId, nonce, a)) as BufferSource));
  return ed.verifyAsync(fromHex(sig), digest, fromHex(publicKey));
}
