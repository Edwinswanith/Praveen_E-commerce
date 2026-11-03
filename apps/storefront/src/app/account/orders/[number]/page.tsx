import type { Metadata } from 'next';
import { OrderDetailPage } from '@/components/account/order-detail';

type Props = { params: Promise<{ number: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { number } = await params;
  return { title: `Order ${decodeURIComponent(number)}` };
}

export default async function Page({ params }: Props) {
  const { number } = await params;
  return <OrderDetailPage number={decodeURIComponent(number)} />;
}
