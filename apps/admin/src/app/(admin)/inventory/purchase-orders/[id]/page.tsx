import { PurchaseOrderDetail } from '@/features/inventory/purchase-orders';

export const metadata = { title: 'Purchase order' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PurchaseOrderDetail id={id} />;
}
