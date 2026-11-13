// Entry for dist/pay.js (IIFE): registers <pay-button> and exposes window.Zap.
import { Zap } from "./index";

if (typeof window !== "undefined" && !window.Zap) {
  window.Zap = Zap;
}
