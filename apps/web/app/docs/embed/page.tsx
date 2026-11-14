import type { Metadata } from "next";
import { DocsEmbed } from "@uc/landing/docs";

export const metadata: Metadata = { title: "Pay button" };

export default function Page() {
  return <DocsEmbed />;
}