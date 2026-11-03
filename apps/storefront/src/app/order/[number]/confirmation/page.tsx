import type { Metadata } from 'next';
import { Container } from '@/components/ui/page-header';
import { OrderConfirmation } from '@/components/checkout/order-confirmation';

export const metadata: Metadata = { title: 'Order confirmed', robots: { index: false } };

export default async function ConfirmationPage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const { number } = await params;
  return (
    <Container className="max-w-3xl py-8">
      <OrderConfirmation number={decodeURIComponent(number)} />
    </Container>
  );
}
