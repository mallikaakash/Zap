import { afterEach, describe, expect, it, vi } from "vitest";
import { UcError, buildSessionBody, checkoutLink, createSession, embedUrl } from "../src/index";

const MONTH = 30 * 86_400;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildSessionBody", () => {
  it("one-time", () => {
    expect(buildSessionBody({ merchant: "shop.testnet", amount: "49", product: "Ebook", orderRef: "o-1" })).toEqual({
      merchantId: "shop.testnet",
      amountUsd: "49000000",
      kind: "OneTime",
      orderRef: "o-1",
      product: "Ebook",
    });
  });

  it("omits optional keys and generates an orderRef", () => {
    const body = buildSessionBody({ merchant: "shop.testnet", amount: "49.99" });
    expect(Object.keys(body).sort()).toEqual(["amountUsd", "kind", "merchantId", "orderRef"]);
    expect(body.orderRef).toMatch(/^uc_[0-9a-f]{32}$/);
    expect(buildSessionBody({ merchant: "shop.testnet", amount: "1" }).orderRef).not.toBe(body.orderRef);
  });

  it("subscription: months tranches of monthly, 30 days apart, first at 0", () => {
    const body = buildSessionBody({ merchant: "shop.testnet", mode: "subscription", months: "3", monthly: "9.99", orderRef: "sub-1" });
    expect(body).toEqual({
      merchantId: "shop.testnet",
      amountUsd: "29970000",
      kind: "Subscription",
      orderRef: "sub-1",
      schedule: [
        { afterSecs: 0, amount: "9990000" },
        { afterSecs: MONTH, amount: "9990000" },
        { afterSecs: 2 * MONTH, amount: "9990000" },
      ],
    });
  });

  it("schedule: afterDays -> afterSecs, amounts to minor units, total is the sum", () => {
    const body = buildSessionBody({
      merchant: "shop.testnet",
      mode: "schedule",
      tranches: '[{"afterDays":0,"amount":"20"},{"afterDays":14,"amount":"19.50"},{"afterDays":30,"amount":"10"}]',
      orderRef: "sch-1",
      metadata: '{"cart":42}',
    });
    expect(body).toEqual({
      merchantId: "shop.testnet",
      amountUsd: "49500000",
      kind: "Schedule",
      orderRef: "sch-1",
      schedule: [
        { afterSecs: 0, amount: "20000000" },
        { afterSecs: 14 * 86_400, amount: "19500000" },
        { afterSecs: 30 * 86_400, amount: "10000000" },
      ],
      metadata: { cart: 42 },
    });
  });

  it("schedule: sorts tranches by unlock time and accepts arrays", () => {
    const body = buildSessionBody({
      merchant: "m.testnet",
      mode: "schedule",
      tranches: [
        { afterDays: 30, amount: "1" },
        { afterDays: 0, amount: "2" },
      ],
    });
    expect(body.schedule).toEqual([
      { afterSecs: 0, amount: "2000000" },
      { afterSecs: 2_592_000, amount: "1000000" },
    ]);
  });

  it("accepts a matching explicit amount and rejects a mismatching one", () => {
    expect(buildSessionBody({ merchant: "m", mode: "subscription", months: 3, monthly: "10", amount: "30" }).amountUsd).toBe("30000000");
    expect(() => buildSessionBody({ merchant: "m", mode: "subscription", months: 3, monthly: "10", amount: "49" })).toThrow(/does not equal/);
  });

  it.each([
    [{ merchant: "", amount: "49" }, /merchant/],
    [{ merchant: "shop.testnet" }, /amount/],
    [{ merchant: "shop.testnet", amount: "0" }, /greater than zero/],
    [{ merchant: "shop.testnet", amount: "-5" }, /amount/],
    [{ merchant: "shop.testnet", amount: "1.2345678" }, /amount/],
    [{ merchant: "shop.testnet", amount: "49", mode: "weekly" }, /mode/],
    [{ merchant: "shop.testnet", mode: "subscription", monthly: "10" }, /months/],
    [{ merchant: "shop.testnet", mode: "subscription", months: "0", monthly: "10" }, /months/],
    [{ merchant: "shop.testnet", mode: "subscription", months: "2.5", monthly: "10" }, /months/],
    [{ merchant: "shop.testnet", mode: "subscription", months: "3" }, /monthly/],
    [{ merchant: "shop.testnet", mode: "schedule" }, /tranches/],
    [{ merchant: "shop.testnet", mode: "schedule", tranches: "nope" }, /tranches/],
    [{ merchant: "shop.testnet", mode: "schedule", tranches: "[]" }, /tranches/],
    [{ merchant: "shop.testnet", mode: "schedule", tranches: '[{"afterDays":-1,"amount":"5"}]' }, /afterDays/],
    [{ merchant: "shop.testnet", mode: "schedule", tranches: '[{"afterDays":1,"amount":"1.5x"}]' }, /amount/],
    [{ merchant: "shop.testnet", mode: "schedule", tranches: '[{"afterDays":1,"amount":4.5}]' }, /amount/],
    [{ merchant: "shop.testnet", amount: "49", metadata: "[1]" }, /metadata/],
    [{ merchant: "shop.testnet", amount: "49", metadata: "{oops" }, /metadata/],
  ])("rejects %j", (cfg, re) => {
    let err: unknown;
    try {
      buildSessionBody(cfg as never);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UcError);
    expect((err as UcError).code).toBe("invalid_config");
    expect((err as UcError).message).toMatch(re);
  });
});

describe("createSession", () => {
  const ok = (data: unknown, status = 200) =>
    vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } }));

  it("POSTs the JSON body to {api}/api/sessions", async () => {
    const fetchMock = ok({ sessionId: "s1", checkoutUrl: "https://pay.example/c/s1" });
    vi.stubGlobal("fetch", fetchMock);
    const s = await createSession({ api: "https://pay.example/", merchant: "shop.testnet", amount: "49", orderRef: "o1" });
    expect(s.sessionId).toBe("s1");
    expect(s.checkoutUrl).toBe("https://pay.example/c/s1");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://pay.example/api/sessions");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({ merchantId: "shop.testnet", amountUsd: "49000000", kind: "OneTime", orderRef: "o1" });
  });

  it("resolves a relative checkoutUrl against the api", async () => {
    vi.stubGlobal("fetch", ok({ sessionId: "s1", checkoutUrl: "/c/s1?x=1" }));
    const s = await createSession({ api: "https://pay.example", merchant: "m", amount: "1" });
    expect(s.checkoutUrl).toBe("https://pay.example/c/s1?x=1");
  });

  it("maps failures to UcError codes", async () => {
    vi.stubGlobal("fetch", ok({ error: "unknown merchant" }, 404));
    await expect(createSession({ api: "https://pay.example", merchant: "m", amount: "1" })).rejects.toMatchObject({ code: "http", status: 404 });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(createSession({ api: "https://pay.example", merchant: "m", amount: "1" })).rejects.toMatchObject({ code: "network" });
    vi.stubGlobal("fetch", ok({ nope: true }));
    await expect(createSession({ api: "https://pay.example", merchant: "m", amount: "1" })).rejects.toMatchObject({ code: "bad_response" });
    vi.stubGlobal("fetch", ok({ sessionId: "s", checkoutUrl: "javascript:alert(1)" }));
    await expect(createSession({ api: "https://pay.example", merchant: "m", amount: "1" })).rejects.toMatchObject({ code: "bad_response" });
  });

  it("does not call fetch for an invalid config", async () => {
    const fetchMock = ok({});
    vi.stubGlobal("fetch", fetchMock);
    await expect(createSession({ api: "https://pay.example", merchant: "m", amount: "abc" })).rejects.toMatchObject({ code: "invalid_config" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("checkoutLink / embedUrl", () => {
  it("builds a shareable /pay link", () => {
    const link = checkoutLink({ api: "https://pay.example", merchant: "shop.testnet", amount: "49", product: "E book", mode: "one-time" });
    expect(link).toBe("https://pay.example/pay?merchant=shop.testnet&amount=49&product=E+book&mode=one-time");
  });

  it("carries subscription and schedule params", () => {
    const sub = new URL(checkoutLink({ api: "https://pay.example", merchant: "m", mode: "subscription", months: 3, monthly: "9.99" }));
    expect(Object.fromEntries(sub.searchParams)).toEqual({ merchant: "m", mode: "subscription", months: "3", monthly: "9.99" });
    const sch = new URL(
      checkoutLink({ api: "https://pay.example", merchant: "m", mode: "schedule", tranches: [{ afterDays: 0, amount: "5" }], orderRef: "o9" }),
    );
    expect(sch.pathname).toBe("/pay");
    expect(JSON.parse(sch.searchParams.get("tranches") ?? "")).toEqual([{ afterDays: 0, amount: "5" }]);
    expect(sch.searchParams.get("orderRef")).toBe("o9");
  });

  it("validates", () => {
    expect(() => checkoutLink({ api: "https://pay.example", merchant: "m", amount: "x" })).toThrow(UcError);
  });

  it("embedUrl appends embed=1 and preserves query + fragment", () => {
    expect(embedUrl("https://pay.example/c/s1")).toBe("https://pay.example/c/s1?embed=1");
    expect(embedUrl("https://pay.example/c/s1?t=abc#frag")).toBe("https://pay.example/c/s1?t=abc&embed=1#frag");
  });
});
