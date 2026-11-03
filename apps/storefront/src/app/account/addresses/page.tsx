import type { Metadata } from 'next';
import { AddressesPage } from '@/components/account/addresses';

export const metadata: Metadata = { title: 'Addresses' };

export default function Page() {
  return <AddressesPage />;
}
