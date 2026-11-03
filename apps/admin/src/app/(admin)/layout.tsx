'use client';
import * as React from 'react';
import { AuthGate } from '@/features/auth/auth-context';
import { AppShell } from '@/components/layout/app-shell';
import { ConfirmProvider } from '@/components/ui/confirm';
import { SWRConfig } from 'swr';
import { ApiError } from '@/lib/api';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: false,
        shouldRetryOnError: (err: unknown) => !(err instanceof ApiError && err.status >= 400 && err.status < 500),
        errorRetryCount: 2,
      }}
    >
      <AuthGate>
        <ConfirmProvider>
          <AppShell>
            <React.Suspense fallback={null}>{children}</React.Suspense>
          </AppShell>
        </ConfirmProvider>
      </AuthGate>
    </SWRConfig>
  );
}
