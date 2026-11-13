import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PayButton, openCheckout } from "../src/index";
import { nav } from "../src/modal";

const API = "https://pay.example";
const CHECKOUT = "https://pay.example/c/sess_1?t=abc";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function mockFetch(data: unknown = { sessionId: "sess_1", checkoutUrl: CHECKOUT }, status = 200) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(data), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

function mount(attrs: Record<string, string>): PayButton {
  const el = document.createElement("pay-button");
  for (const [k, v] of Object.entries({ api: API, ...attrs })) el.setAttribute(k, v);
  document.body.appendChild(el);
  return el;
}

const inner = (el: PayButton) => el.shadowRoot?.querySelector("button") as HTMLButtonElement;
const modal = () => document.querySelector("uc-checkout-modal");
const frame = () => modal()?.shadowRoot?.querySelector("iframe") as HTMLIFrameElement | null;
const post = (data: unknown, origin = "https://pay.example") => window.dispatchEvent(new MessageEvent("message", { data, origin }));
const events = (el: Element, type: string) => {
  const seen: CustomEvent[] = [];
  el.addEventListener(type, (e) => seen.push(e as CustomEvent));
  return seen;
};

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  // Let happy-dom "load" checkout iframes from a stub instead of the network.
  const settings = (window as unknown as { happyDOM: { settings: Record<string, any> } }).happyDOM.settings;
  settings.enableIframePageLoading = true;
  settings.fetch.interceptor = {
    beforeAsyncRequest: async ({ window: w }: { window: { Response: typeof Response } }) =>
      new w.Response("<!doctype html><title>checkout</title>", { headers: { "content-type": "text/html" } }),
  };
});

afterEach(() => {
  window.dispatchEvent(new MessageEvent("message", { data: { source: "zap", type: "uc:close" }, origin: "https://pay.example" }));
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("<pay-button> registration and rendering", () => {
  it("is defined, and re-registering does not throw", async () => {
    expect(customElements.get("pay-button")).toBe(PayButton);
    const { register } = await import("../src/index");
    expect(() => register()).not.toThrow();
  });

  it("renders a real button in shadow DOM with the default label", () => {
    const el = mount({ merchant: "shop.testnet", amount: "49" });
    expect(inner(el).tagName).toBe("BUTTON");
    expect(inner(el).textContent).toBe("Pay any way");
    expect(inner(el).disabled).toBe(false);
    expect(inner(el).querySelector("svg")).not.toBeNull();
  });

  it("reacts to label / color / radius / text-color changes synchronously", () => {
    const el = mount({ merchant: "shop.testnet", amount: "49", label: "Buy", color: "#4F46E5", radius: "12" });
    const btn = inner(el);
    expect(btn.textContent).toBe("Buy");
    expect(btn.style.getPropertyValue("--uc-color")).toBe("#4F46E5");
    expect(btn.style.getPropertyValue("--uc-radius")).toBe("12px");
    expect(btn.style.getPropertyValue("--uc-text-color")).toBe("#fff");

    el.setAttribute("label", "Pay with any coin");
    el.setAttribute("color", "#FDE047");
    el.setAttribute("radius", "999");
    expect(btn.textContent).toBe("Pay with any coin");
    expect(btn.style.getPropertyValue("--uc-color")).toBe("#FDE047");
    expect(btn.style.getPropertyValue("--uc-radius")).toBe("999px");
    expect(btn.style.getPropertyValue("--uc-text-color")).toBe("#0f172a"); // auto contrast on a light colour

    el.setAttribute("text-color", "#ff0000");
    expect(btn.style.getPropertyValue("--uc-text-color")).toBe("#ff0000");

    el.removeAttribute("color");
    el.removeAttribute("text-color");
    el.removeAttribute("radius");
    el.removeAttribute("label");
    expect(btn.style.getPropertyValue("--uc-color")).toBe("");
    expect(btn.style.getPropertyValue("--uc-text-color")).toBe("");
    expect(btn.style.getPropertyValue("--uc-radius")).toBe("");
    expect(btn.textContent).toBe("Pay any way");
  });

  it("disables the button and logs a clear error for invalid config, and recovers when fixed", async () => {
    const el = mount({ merchant: "shop.testnet", amount: "abc" });
    expect(inner(el).disabled).toBe(true);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toMatch(/\[pay-button\] invalid configuration: `amount`/);

    el.setAttribute("amount", "49.99");
    await tick();
    expect(inner(el).disabled).toBe(false);
    expect(el.error).toBeNull();

    el.removeAttribute("merchant");
    await tick();
    expect(inner(el).disabled).toBe(true);
    expect(el.error).toMatch(/merchant/);
  });

  it("does not fetch when invalid or disabled", async () => {
    const fetchMock = mockFetch();
    const bad = mount({ merchant: "shop.testnet", mode: "subscription", months: "3" });
    await bad.pay();
    const off = mount({ merchant: "shop.testnet", amount: "5", disabled: "" });
    expect(inner(off).disabled).toBe(true);
    await off.pay();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("<pay-button> checkout flow", () => {
  it("click posts the session body and opens the modal iframe with embed=1", async () => {
    const fetchMock = mockFetch();
    const el = mount({ merchant: "shop.testnet", amount: "49", product: "Ebook", "order-ref": "order-7", metadata: '{"sku":"eb-1"}' });
    inner(el).click();
    expect(inner(el).getAttribute("aria-busy")).toBe("true");
    await tick();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://pay.example/api/sessions");
    expect(JSON.parse(String(init?.body))).toEqual({
      merchantId: "shop.testnet",
      amountUsd: "49000000",
      kind: "OneTime",
      orderRef: "order-7",
      product: "Ebook",
      metadata: { sku: "eb-1" },
    });
    expect(frame()?.getAttribute("src")).toBe("https://pay.example/c/sess_1?t=abc&embed=1");
    expect(modal()?.parentElement).toBe(document.body);
    expect(modal()?.shadowRoot?.querySelector("[role=dialog]")?.getAttribute("aria-modal")).toBe("true");
    expect(inner(el).hasAttribute("aria-busy")).toBe(false);
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(el.hasAttribute("inert")).toBe(true);
  });

  it("sends subscription and schedule bodies from attributes", async () => {
    const fetchMock = mockFetch();
    const sub = mount({ merchant: "shop.testnet", mode: "subscription", months: "3", monthly: "10", "order-ref": "s" });
    await sub.pay();
    sub.close();
    const sch = mount({ merchant: "shop.testnet", mode: "schedule", tranches: '[{"afterDays":0,"amount":"20"},{"afterDays":30,"amount":"29"}]', "order-ref": "t" });
    await sch.pay();
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(String(c[1]?.body)));
    expect(bodies[0]).toEqual({
      merchantId: "shop.testnet",
      amountUsd: "30000000",
      kind: "Subscription",
      orderRef: "s",
      schedule: [
        { afterSecs: 0, amount: "10000000" },
        { afterSecs: 2_592_000, amount: "10000000" },
        { afterSecs: 5_184_000, amount: "10000000" },
      ],
    });
    expect(bodies[1]).toEqual({
      merchantId: "shop.testnet",
      amountUsd: "49000000",
      kind: "Schedule",
      orderRef: "t",
      schedule: [
        { afterSecs: 0, amount: "20000000" },
        { afterSecs: 2_592_000, amount: "29000000" },
      ],
    });
  });

  it("ignores messages from the wrong origin or source, accepts the checkout origin", async () => {
    mockFetch();
    const el = mount({ merchant: "shop.testnet", amount: "49" });
    const paid = events(document.body, "uc:paid");
    const closed = events(document.body, "uc:closed");
    await el.pay();

    const msg = { source: "zap", type: "uc:paid", sessionId: "sess_1", receiptId: "r_9", receiptUrl: "https://pay.example/r/r_9#secret" };
    post(msg, "https://evil.example");
    post({ ...msg, type: "uc:close" }, "https://evil.example");
    post({ ...msg, source: "someone-else" });
    post({ ...msg, sessionId: "another-session" });
    post("uc:paid");
    post(null);
    expect(paid).toHaveLength(0);
    expect(closed).toHaveLength(0);
    expect(modal()).not.toBeNull();

    post(msg);
    post(msg); // duplicate is ignored
    expect(paid).toHaveLength(1);
    expect(paid[0]?.detail).toEqual({ sessionId: "sess_1", receiptId: "r_9", receiptUrl: "https://pay.example/r/r_9#secret" });
    expect(paid[0]?.bubbles).toBe(true);
    expect(paid[0]?.composed).toBe(true);
    expect(paid[0]?.target).toBe(el);
    expect(inner(el).textContent).toBe("Paid");
    expect(el.state).toBe("success");
    expect(modal()).not.toBeNull(); // stays open so the customer can see the receipt

    post({ source: "zap", type: "uc:close", sessionId: "sess_1" });
    expect(closed).toHaveLength(1);
    expect(closed[0]?.detail).toEqual({ sessionId: "sess_1", paid: true });
    expect(document.documentElement.style.overflow).toBe("");
    expect(el.hasAttribute("inert")).toBe(false);
  });

  it("Esc, the close button and the backdrop close with paid:false", async () => {
    mockFetch();
    const el = mount({ merchant: "shop.testnet", amount: "49" });
    const closed = events(el, "uc:closed");

    await el.pay();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(closed).toHaveLength(1);
    expect(closed[0]?.detail).toEqual({ sessionId: "sess_1", paid: false });
    expect(el.state).toBe("idle");

    await el.pay();
    const close = Array.from(document.querySelectorAll("uc-checkout-modal")).pop()?.shadowRoot?.querySelector<HTMLButtonElement>(".x");
    expect(close?.getAttribute("aria-label")).toBe("Close checkout");
    close?.click();
    expect(closed).toHaveLength(2);

    await el.pay();
    Array.from(document.querySelectorAll("uc-checkout-modal")).pop()?.shadowRoot?.querySelector<HTMLElement>(".b")?.click();
    expect(closed).toHaveLength(3);
  });

  it("removes the modal element after closing", async () => {
    mockFetch();
    const el = mount({ merchant: "shop.testnet", amount: "49" });
    await el.pay();
    el.close();
    await new Promise((r) => setTimeout(r, 320));
    expect(modal()).toBeNull();
  });

  it("uc:resize adjusts the dialog height", async () => {
    mockFetch();
    const el = mount({ merchant: "shop.testnet", amount: "49" });
    await el.pay();
    post({ source: "zap", type: "uc:resize", sessionId: "sess_1", height: 600 });
    const dialog = modal()?.shadowRoot?.querySelector<HTMLElement>(".d");
    expect(dialog?.style.getPropertyValue("--h")).toBe("653px");
  });

  it("display=redirect navigates instead of opening a modal", async () => {
    mockFetch();
    const assign = vi.spyOn(nav, "assign").mockImplementation(() => {});
    const el = mount({ merchant: "shop.testnet", amount: "49", display: "redirect" });
    await el.pay();
    expect(assign).toHaveBeenCalledWith(CHECKOUT);
    expect(modal()).toBeNull();
  });

  it("dispatches uc:error on non-2xx and network failure, then re-enables", async () => {
    mockFetch({ error: "merchant not found" }, 404);
    const el = mount({ merchant: "shop.testnet", amount: "49" });
    const errors = events(document.body, "uc:error");
    await el.pay();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.detail).toMatchObject({ code: "http", status: 404 });
    expect(errors[0]?.detail.message).toMatch(/merchant not found/);
    expect(el.shadowRoot?.querySelector("[role=alert]")?.textContent).toMatch(/try again/i);
    expect(inner(el).disabled).toBe(false);
    expect(inner(el).hasAttribute("aria-busy")).toBe(false);
    expect(modal()).toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await el.pay();
    expect(errors).toHaveLength(2);
    expect(errors[1]?.detail.code).toBe("network");

    mockFetch(); // retry works
    await el.pay();
    expect(modal()).not.toBeNull();
    expect(el.shadowRoot?.querySelector("[role=alert]")?.textContent).toBe("");
  });

  it("ignores a second click while loading", async () => {
    const fetchMock = mockFetch();
    const el = mount({ merchant: "shop.testnet", amount: "49" });
    inner(el).click();
    inner(el).click();
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("openCheckout (programmatic)", () => {
  it("calls onPaid / onClose and verifies origin", () => {
    const onPaid = vi.fn();
    const onClose = vi.fn();
    const handle = openCheckout("https://checkout.example/c/abc", { sessionId: "abc", onPaid, onClose });
    expect(handle.display).toBe("modal");
    post({ source: "zap", type: "uc:paid", sessionId: "abc", receiptId: "r1" }, "https://pay.example");
    expect(onPaid).not.toHaveBeenCalled();
    post({ source: "zap", type: "uc:paid", sessionId: "abc", receiptId: "r1" }, "https://checkout.example");
    expect(onPaid).toHaveBeenCalledWith({ sessionId: "abc", receiptId: "r1", receiptUrl: undefined });
    expect(handle.paid).toBe(true);
    handle.close();
    handle.close();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith({ sessionId: "abc", paid: true });
  });

  it("rejects non-http(s) URLs", () => {
    expect(() => openCheckout("javascript:alert(1)")).toThrow();
  });
});
