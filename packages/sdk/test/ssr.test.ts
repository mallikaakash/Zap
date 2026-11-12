// @vitest-environment node
import { expect, it } from "vitest";

it("can be imported without a DOM (SSR) and helpers still work", async () => {
  expect(typeof HTMLElement).toBe("undefined");
  const sdk = await import("../src/index");
  expect(() => sdk.register()).not.toThrow();
  expect(sdk.usdToMinor("49.99")).toBe("49990000");
  expect(sdk.buildSessionBody({ merchant: "shop.testnet", amount: "49", orderRef: "o" }).amountUsd).toBe("49000000");
  expect(sdk.checkoutLink({ api: "https://pay.example", merchant: "m", amount: "1" })).toBe(
    "https://pay.example/pay?merchant=m&amount=1&mode=one-time",
  );
});
