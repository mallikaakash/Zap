import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DocsLayout } from "@uc/landing/docs";

export const metadata: Metadata = {
  title: { default: "Documentation", template: "%s · Docs · Zap" },
  description: "Integrate Zap: pay.js, webhooks, checkout events, and the HTTP API.",
};

export default function DocsRootLayout({ children }: { children: ReactNode }) {
  return <DocsLayout>{children}</DocsLayout>;
}