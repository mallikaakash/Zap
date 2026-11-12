import { describe, expect, it } from "vitest";
import { minorToUsd, usdToMinor } from "../src/index";

describe("usdToMinor", () => {
  it.each([
    ["49", "49000000"],
    ["49.99", "49990000"],
    ["0.000001", "1"],
    ["0", "0"],
    ["0.1", "100000"],
    ["1.10", "1100000"],
    ["007", "7000000"],
    [" 12.5 ", "12500000"],
    ["0.07", "70000"], // 0.07 * 1e6 is 70000.00000000001 in floats
    ["1.15", "1150000"],
    ["999999999999999.999999", "999999999999999999999"],
  ])("%s -> %s", (usd, minor) => {
    expect(usdToMinor(usd)).toBe(minor);
  });

  it.each(["1.2345678", "-1", "-0.5", "+1", "abc", "", " ", "1e3", "1,000", "$5", ".5", "5.", "1.2.3", "0x10", "NaN", "Infinity", "1 000"])(
    "rejects %j",
    (junk) => {
      expect(() => usdToMinor(junk)).toThrow(/Invalid USD amount/);
    },
  );

  it("rejects non-strings (no float input)", () => {
    expect(() => usdToMinor(49.99 as unknown as string)).toThrow();
    expect(() => usdToMinor(null as unknown as string)).toThrow();
    expect(() => usdToMinor(undefined as unknown as string)).toThrow();
  });
});

describe("minorToUsd", () => {
  it.each([
    ["49000000", "49"],
    ["49990000", "49.99"],
    ["49500000", "49.50"],
    ["1", "0.000001"],
    ["0", "0"],
    ["1234567", "1.234567"],
    ["999999999999999999999", "999999999999999.999999"],
  ])("%s -> %s", (minor, usd) => {
    expect(minorToUsd(minor)).toBe(usd);
  });

  it("accepts bigint", () => {
    expect(minorToUsd(147_000_000n)).toBe("147");
  });

  it.each(["-1", "1.5", "abc", "", "1e6"])("rejects %j", (junk) => {
    expect(() => minorToUsd(junk)).toThrow(/Invalid minor-unit amount/);
  });

  it("round-trips", () => {
    for (const usd of ["49", "49.99", "0.000001", "123456.654321"]) {
      expect(minorToUsd(usdToMinor(usd))).toBe(usd);
    }
  });
});
