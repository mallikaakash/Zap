import path from "node:path";
import type { NextConfig } from "next";

// The checkout app this page talks to (pay.js, /dashboard, /verify, /api/*).
// Required for production builds so a deploy can't silently point at localhost.
const appUrl = process.env.NEXT_PUBLIC_APP_URL;
if (process.env.NODE_ENV === "production" && !appUrl) {
  throw new Error("Set NEXT_PUBLIC_APP_URL to the checkout app's https origin, e.g. https://zap-2lcs3sivbq-uc.a.run.app");
}

const nextConfig: NextConfig = {
  output: "export",
  transpilePackages: ["@uc/landing"],
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_APP_URL: appUrl ?? "http://localhost:3000" },
  turbopack: { root: path.join(__dirname, "../..") },
};

export default nextConfig;
