import type { Metadata } from "next";
import { DocsApi } from "@uc/landing/docs";

export const metadata: Metadata = { title: "HTTP API" };

export default function Page() {
  return <DocsApi />;
}