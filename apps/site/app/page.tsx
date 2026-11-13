import path from "node:path";
import { Landing } from "@uc/landing";
import { payJsGzipBytes } from "@uc/landing/measure";

export default function Home() {
  // Measured at build time from the SDK build that the checkout app serves.
  const bytes = payJsGzipBytes([path.join(process.cwd(), "../../packages/sdk/dist/pay.js"), path.join(process.cwd(), "../web/public/pay.js")]);
  return <Landing appUrl={process.env.NEXT_PUBLIC_APP_URL} demoMerchant={process.env.NEXT_PUBLIC_DEMO_MERCHANT || undefined} stats={{ payJsGzipBytes: bytes }} />;
}
