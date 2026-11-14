import ReceiptPage from "./receipt";

export const metadata = { title: "Your receipt" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ReceiptPage id={(await params).id} />;
}
