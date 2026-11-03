import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Container } from '@/components/ui/page-header';
import { TrackOrder } from '@/components/account/track-order';

export const metadata: Metadata = {
  title: 'Track your order',
  description: 'Track a VYRA order with your order number and email or mobile number.',
};

export default function Page() {
  return (
    <Container className="max-w-5xl">
      <Suspense>
        <TrackOrder />
      </Suspense>
    </Container>
  );
}
