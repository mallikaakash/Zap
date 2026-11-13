import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Zap · Any coin in, USDC out",
  description: "One pay button for any site. Shoppers pay in any coin on any chain through NEAR Intents; sellers get USDC; every payment is a receipt NFT that holds the money in escrow until the refund window closes.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ffffff" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#ffffff" }}>{children}</body>
    </html>
  );
}
