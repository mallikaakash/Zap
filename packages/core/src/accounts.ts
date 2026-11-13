/** NEAR account id rules (https://docs.near.org/concepts/protocol/account-id). */
const NAMED = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const IMPLICIT = /^[0-9a-f]{64}$/;

/** A full account id: named with a dot (alice.near) or a 64-hex implicit account. */
export function isFullAccountId(account: string): boolean {
  return IMPLICIT.test(account) || (account.includes(".") && NAMED.test(account));
}

/**
 * Live mode can't create accounts for shoppers, so a claim needs an existing one.
 * Returns the message to show, or null when the account is usable.
 */
export function liveClaimAccountError(account: string, exists: boolean, networkId: string): string | null {
  if (!isFullAccountId(account)) return "Enter your full NEAR account, for example alice.near. On this server we can't create an account for you.";
  if (!exists) return `${account} doesn't exist on NEAR ${networkId}. Check the spelling, or create the account in a NEAR wallet first.`;
  return null;
}
