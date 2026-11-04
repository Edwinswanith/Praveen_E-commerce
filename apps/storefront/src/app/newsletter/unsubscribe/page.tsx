import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NewsletterUnsubscribe } from '@/components/newsletter/newsletter-links';

export const metadata: Metadata = { title: 'Unsubscribe', robots: { index: false, follow: false } };

export default function NewsletterUnsubscribePage() {
  return (
    <Suspense>
      <NewsletterUnsubscribe />
    </Suspense>
  );
}
