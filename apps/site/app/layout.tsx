import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

const title = "Zap";
const description = "One pay button for any site. Shoppers pay in any coin on any chain through NEAR Intents; sellers get USDC; every payment is a receipt NFT that holds the money in escrow until the refund window closes.";
const site = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  title,
  description,
  ...(site ? { metadataBase: new URL(site) } : {}),
  openGraph: { title, description, siteName: "Zap", type: "website", images: [{ url: "/og.png", width: 1200, height: 630, alt: "Any coin in. USDC out. A phone pays into a safe that holds a receipt NFT." }] },
  twitter: { card: "summary_large_image", title, description, images: ["/og.png"] },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ffffff" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#ffffff" }}>{children}</body>
    </html>
  );
}
