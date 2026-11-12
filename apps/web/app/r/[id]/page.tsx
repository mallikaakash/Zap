import ReceiptPage from "./receipt";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ReceiptPage id={(await params).id} />;
}
