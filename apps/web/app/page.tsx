import type { Metadata } from "next";
import { headers } from "next/headers";
import { Landing } from "@uc/landing";

/** Absolute origin of this request (works behind Cloud Run / Caddy), for share-card URLs. */
async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return process.env.PUBLIC_URL?.replace(/\/+$/, "") || `${proto}://${host}`;
}

export async function generateMetadata(): Promise<Metadata> {
  const base = await origin();
  const title = "Zap · Any coin in, USDC out";
  const description = "Crypto checkout for SaaS and online businesses. Customers pay in any coin on any chain through NEAR Intents; you get USDC; every payment is a receipt NFT that holds the money in escrow until the refund window closes.";
  return {
    title,
    description,
    metadataBase: new URL(base),
    openGraph: { title, description, url: base, siteName: "Zap", type: "website", images: [{ url: "/og.png", width: 1200, height: 630, alt: "Any coin in. USDC out. A phone pays into a safe that holds a receipt NFT." }] },
    twitter: { card: "summary_large_image", title, description, images: ["/og.png"] },
  };
}

/** Landing page. The design lives in packages/landing so apps/site can serve the same page statically. */
export default function Home() {
  return <Landing />;
}
