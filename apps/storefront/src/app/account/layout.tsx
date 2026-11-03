import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Container } from '@/components/ui/page-header';
import { AccountShell } from '@/components/account/account-shell';

export const metadata: Metadata = { title: 'My account', robots: { index: false } };

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <Container>
      <Suspense>
        <AccountShell>{children}</AccountShell>
      </Suspense>
    </Container>
  );
}
