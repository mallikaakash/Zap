/**
 * @uc/sdk — Zap browser SDK.
 * Importing this module registers `<pay-button>` (no-op under SSR).
 */
import { minorToUsd, usdToMinor } from "./money";
import { openCheckout } from "./modal";
import { register } from "./pay-button";
import { buildSessionBody, checkoutLink, createSession } from "./session";

export { UcError, type UcErrorCode } from "./errors";
export { USDC_DECIMALS, minorToUsd, usdToMinor } from "./money";
export {
  MESSAGE_SOURCE,
  embedUrl,
  openCheckout,
  type CheckoutHandle,
  type CheckoutMessage,
  type CheckoutMessageType,
  type ClosedDetail,
  type OpenCheckoutOptions,
  type PaidDetail,
} from "./modal";
export {
  DAY_SECS,
  MONTH_SECS,
  buildSessionBody,
  checkoutLink,
  createSession,
  defaultApi,
  generateOrderRef,
  resolveApi,
  type CheckoutConfig,
  type CheckoutLinkOptions,
  type CreateSessionOptions,
  type Mode,
  type ScheduleItem,
  type Session,
  type SessionKind,
  type SessionRequestBody,
  type SessionResponse,
  type TrancheInput,
} from "./session";
export { DEFAULT_LABEL, PayButton, TAG, register, type ErrorDetail } from "./pay-button";

export const VERSION = "0.1.0";

/** The object exposed as `window.Zap` by `pay.js`. */
export const Zap = {
  version: VERSION,
  createSession,
  openCheckout,
  checkoutLink,
  buildSessionBody,
  usdToMinor,
  minorToUsd,
  register,
};
export type ZapApi = typeof Zap;

declare global {
  interface Window {
    Zap?: ZapApi;
  }
  interface HTMLElementTagNameMap {
    "pay-button": import("./pay-button").PayButton;
  }
  interface HTMLElementEventMap {
    "uc:paid": CustomEvent<import("./modal").PaidDetail>;
    "uc:closed": CustomEvent<import("./modal").ClosedDetail>;
    "uc:error": CustomEvent<import("./pay-button").ErrorDetail>;
  }
}

register();
