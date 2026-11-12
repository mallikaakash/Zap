import Checkout from "./checkout";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Checkout sessionId={(await params).id} />;
}
