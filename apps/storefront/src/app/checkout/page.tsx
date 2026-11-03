import type { Metadata } from 'next';
import { Container } from '@/components/ui/page-header';
import { CheckoutView } from '@/components/checkout/checkout-view';

export const metadata: Metadata = { title: 'Checkout', robots: { index: false } };

export default function CheckoutPage() {
  return (
    <Container className="max-w-6xl">
      <CheckoutView />
    </Container>
  );
}
