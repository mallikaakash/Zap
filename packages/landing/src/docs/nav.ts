export interface DocNavItem {
  href: string;
  title: string;
  description?: string;
}

/** Sidebar order — matches how SaaS products group integrator docs. */
export const DOC_NAV: DocNavItem[] = [
  { href: "/docs", title: "Introduction", description: "What Zap is and how the pieces connect" },
  { href: "/docs/quickstart", title: "Quickstart", description: "Embed checkout in a few minutes" },
  { href: "/docs/embed", title: "Pay button", description: "pay.js and <pay-button>" },
  { href: "/docs/events", title: "Checkout events", description: "postMessage and DOM events" },
  { href: "/docs/webhooks", title: "Webhooks", description: "Signed server notifications" },
  { href: "/docs/api", title: "HTTP API", description: "Sessions, merchants, receipts" },
];