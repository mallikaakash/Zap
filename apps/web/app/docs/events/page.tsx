import type { Metadata } from "next";
import { DocsEvents } from "@uc/landing/docs";

export const metadata: Metadata = { title: "Checkout events" };

export default function Page() {
  return <DocsEvents />;
}