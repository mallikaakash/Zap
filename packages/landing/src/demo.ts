/** Generic merchant copy for marketing mocks — not a real customer. */
export const DEMO = {
  name: "Your business",
  account: "your-business.near",
  site: "your-site.com/pricing",
  possessive: "Your business's",
} as const;

/** One example order reused across landing mocks (refunds, verify, dashboard). */
export const DEMO_ORDER = {
  id: "1042",
  amountDisplay: "$24.00",
  usdc: "24.00 USDC",
  productLine: "Pro plan · 1 year",
  productShort: "Pro plan",
} as const;