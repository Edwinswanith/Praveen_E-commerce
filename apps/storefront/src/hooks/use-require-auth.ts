'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from './use-auth';

/** Client-side guard for account pages: redirects anonymous visitors to /login?next=<current>. */
export function useRequireAuth() {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  React.useEffect(() => {
    if (!auth.loading && !auth.user) {
      const qs = search.toString();
      const next = `${pathname}${qs ? `?${qs}` : ''}`;
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [auth.loading, auth.user, pathname, router, search]);

  return auth;
}

/** Only allow same-site relative redirects. */
export function safeNext(next: string | null | undefined, fallback = '/account'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return fallback;
  return next;
}
