import type { Metadata } from 'next';
import { Suspense } from 'react';
import { VerifyEmail } from '@/components/auth/password-flows';

export const metadata: Metadata = { title: 'Verify email', robots: { index: false } };

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmail />
    </Suspense>
  );
}
