import { Landing } from "@uc/landing";

export default function Home() {
  return <Landing appUrl={process.env.NEXT_PUBLIC_APP_URL} demoMerchant={process.env.NEXT_PUBLIC_DEMO_MERCHANT || undefined} />;
}
