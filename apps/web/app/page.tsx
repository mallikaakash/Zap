import { Landing } from "@uc/landing";

/** Landing page. The design lives in packages/landing so apps/site can serve the same page statically. */
export default function Home() {
  return <Landing />;
}
