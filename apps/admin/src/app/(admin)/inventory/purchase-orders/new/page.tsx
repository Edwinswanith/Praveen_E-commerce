import { PurchaseOrderCreate } from '@/features/inventory/purchase-orders';

export const metadata = { title: 'New purchase order' };

export default function Page() {
  return <PurchaseOrderCreate />;
}
