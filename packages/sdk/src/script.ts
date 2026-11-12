// Entry for dist/pay.js (IIFE): registers <pay-button> and exposes window.UniversalCheckout.
import { UniversalCheckout } from "./index";

if (typeof window !== "undefined" && !window.UniversalCheckout) {
  window.UniversalCheckout = UniversalCheckout;
}
