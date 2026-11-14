import type { Metadata } from "next";
import { DocsQuickstart } from "@uc/landing/docs";

export const metadata: Metadata = { title: "Quickstart" };

export default function Page() {
  return <DocsQuickstart />;
}