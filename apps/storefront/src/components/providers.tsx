'use client';

import * as React from 'react';
import { SWRConfig } from 'swr';
import { Toaster } from 'sonner';
import { ApiError, swrFetcher } from '@/lib/api';
import { AuthProvider } from '@/hooks/use-auth';
import { initAnalytics } from '@/lib/analytics';

export function Providers({ children }: { children: React.ReactNode }) {
  // Capture the landing page's utm_source as the session's first touch.
  React.useEffect(() => initAnalytics(), []);
  return (
    <SWRConfig
      value={{
        fetcher: swrFetcher,
        dedupingInterval: 2000,
        shouldRetryOnError: (err: unknown) =>
          !(err instanceof ApiError) || err.status >= 500 || err.status === 0,
        errorRetryCount: 2,
      }}
    >
      <AuthProvider>{children}</AuthProvider>
      <Toaster
        position="top-center"
        richColors
        closeButton
        toastOptions={{ className: 'font-sans' }}
      />
    </SWRConfig>
  );
}
