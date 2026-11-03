'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@vyra/ui';
import { pageHref, pageWindow } from '@/lib/listing-params';

export function Pagination({ page, totalPages }: { page: number; totalPages: number }) {
  const pathname = usePathname();
  const search = useSearchParams();
  if (totalPages <= 1) return null;
  const params = new URLSearchParams(search.toString());
  const cls = 'flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-sm font-semibold';
  return (
    <nav aria-label="Pagination" className="mt-10 flex items-center justify-center gap-1">
      {page > 1 ? (
        <Link
          href={pageHref(pathname, params, page - 1)}
          className={cn(cls, 'hover:bg-surface-2')}
          rel="prev"
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
      ) : (
        <span className={cn(cls, 'text-subtle')} aria-hidden>
          <ChevronLeft className="size-4" />
        </span>
      )}
      {pageWindow(page, totalPages).map((p, i) =>
        p === '…' ? (
          <span key={`e${i}`} className="px-1 text-muted" aria-hidden>
            …
          </span>
        ) : (
          <Link
            key={p}
            href={pageHref(pathname, params, p)}
            aria-current={p === page ? 'page' : undefined}
            className={cn(cls, p === page ? 'bg-fg text-white' : 'hover:bg-surface-2')}
          >
            {p}
          </Link>
        ),
      )}
      {page < totalPages ? (
        <Link
          href={pageHref(pathname, params, page + 1)}
          className={cn(cls, 'hover:bg-surface-2')}
          rel="next"
          aria-label="Next page"
        >
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      ) : (
        <span className={cn(cls, 'text-subtle')} aria-hidden>
          <ChevronRight className="size-4" />
        </span>
      )}
    </nav>
  );
}
