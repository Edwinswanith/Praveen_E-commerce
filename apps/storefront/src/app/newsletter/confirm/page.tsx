import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NewsletterConfirm } from '@/components/newsletter/newsletter-links';

export const metadata: Metadata = { title: 'Confirm subscription', robots: { index: false, follow: false } };

export default function NewsletterConfirmPage() {
  return (
    <Suspense>
      <NewsletterConfirm />
    </Suspense>
  );
}
