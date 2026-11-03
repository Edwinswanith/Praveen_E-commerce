import type { Metadata } from 'next';
import { Container } from '@/components/ui/page-header';
import { CartView } from '@/components/cart/cart-view';

export const metadata: Metadata = { title: 'Shopping bag', robots: { index: false } };

export default function CartPage() {
  return (
    <Container>
      <CartView />
    </Container>
  );
}
