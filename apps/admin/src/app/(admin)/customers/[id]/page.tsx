import { CustomerDetail } from '@/features/customers/customers';

export const metadata = { title: 'Customer' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CustomerDetail id={id} />;
}
