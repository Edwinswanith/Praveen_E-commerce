import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Container } from '@/components/ui/page-header';
import { WishlistPage } from '@/components/account/wishlist';

export const metadata: Metadata = { title: 'Wishlist', robots: { index: false } };

export default function Page() {
  return (
    <Container>
      <Suspense>
        <WishlistPage />
      </Suspense>
    </Container>
  );
}
