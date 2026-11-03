'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@vyra/ui';

interface ListingNav {
  params: URLSearchParams;
  pending: boolean;
  /** Navigate to `pathname?qs` without scrolling, as a transition (grid dims while loading). */
  navigate: (qs: string) => void;
}

const Ctx = React.createContext<ListingNav | null>(null);

export function useListingNav(): ListingNav {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error('useListingNav must be used within <ListingShell>');
  return ctx;
}

export function ListingShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, start] = React.useTransition();
  const params = React.useMemo(() => new URLSearchParams(search.toString()), [search]);
  const navigate = React.useCallback(
    (qs: string) =>
      start(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })),
    [router, pathname],
  );
  const value = React.useMemo(() => ({ params, pending, navigate }), [params, pending, navigate]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Wraps server-rendered results so they fade while a new filter set loads. */
export function ListingResults({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { pending } = useListingNav();
  return (
    <div
      aria-busy={pending}
      className={cn('transition-opacity', pending && 'pointer-events-none opacity-50', className)}
    >
      {children}
    </div>
  );
}
