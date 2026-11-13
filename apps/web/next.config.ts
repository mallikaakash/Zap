import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@uc/chain", "@uc/core", "@uc/db", "@uc/intents-adapter", "@uc/landing", "@uc/sdk"],
  serverExternalPackages: ["@prisma/client", "near-kit"],
  turbopack: {
    root: path.join(__dirname, "../.."),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      // The pay button script and the session API are called from merchants' sites.
      { source: "/pay.js", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }, { key: "Cache-Control", value: "public, max-age=300" }] },
    ];
  },
};

export default nextConfig;
