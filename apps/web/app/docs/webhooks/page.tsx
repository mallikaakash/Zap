import type { Metadata } from "next";
import { DocsWebhooks } from "@uc/landing/docs";

export const metadata: Metadata = { title: "Webhooks" };

export default function Page() {
  return <DocsWebhooks />;
}