'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Heart, Menu, ShoppingBag } from 'lucide-react';
import type { CategoryNode } from '@vyra/shared';
import { VyraLogo } from '@vyra/ui';
import { toNav } from '@/lib/categories';
import { useCart } from '@/hooks/use-cart';
import { useWishlist } from '@/hooks/use-wishlist';
import { SearchBox } from './search-box';
import { AccountMenu } from './account-menu';
import { MegaNav } from './mega-nav';
import { MobileNav } from './mobile-nav';
import { VisualSearchDialog } from './visual-search-dialog';

function CountBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span
      className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-[10px] font-bold text-white"
      aria-hidden
    >
      {n > 99 ? '99+' : n}
    </span>
  );
}

export function Header({ initialCategories }: { initialCategories: CategoryNode[] }) {
  const { data: categories } = useSWR<CategoryNode[]>('/categories', {
    fallbackData: initialCategories,
    revalidateOnMount: initialCategories.length === 0,
    revalidateOnFocus: false,
  });
  const nav = React.useMemo(() => toNav(categories ?? []).slice(0, 6), [categories]);
  const { count: bagCount } = useCart();
  const { count: wishCount } = useWishlist();
  const [drawer, setDrawer] = React.useState(false);
  const [visual, setVisual] = React.useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/95 backdrop-blur supports-[backdrop-filter]:bg-bg/85">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:gap-4 sm:px-6 lg:h-16 lg:px-8">
        <button
          type="button"
          className="-ml-2 rounded-md p-2 lg:hidden"
          onClick={() => setDrawer(true)}
          aria-label="Open menu"
        >
          <Menu className="size-5" aria-hidden />
        </button>
        <Link
          href="/"
          className="shrink-0 text-[22px] text-fg lg:text-[26px]"
          aria-label="VYRA home"
        >
          <VyraLogo />
        </Link>
        <MegaNav items={nav} />
        <React.Suspense
          fallback={<div className="hidden h-10 flex-1 rounded-md bg-surface-2 md:block" />}
        >
          <SearchBox
            onVisualSearch={() => setVisual(true)}
            className="ml-auto hidden w-full max-w-md md:block"
          />
        </React.Suspense>
        <nav aria-label="Account" className="ml-auto flex items-center gap-1 md:ml-0 sm:gap-2">
          <AccountMenu />
          <Link
            href="/wishlist"
            className="relative flex flex-col items-center gap-0.5 rounded-md px-2 py-1 hover:text-brand-600"
            aria-label={`Wishlist${wishCount ? `, ${wishCount} items` : ''}`}
          >
            <span className="relative">
              <Heart className="size-5" aria-hidden />
              <CountBadge n={wishCount} />
            </span>
            <span className="hidden text-[11px] font-semibold lg:block">Wishlist</span>
          </Link>
          <Link
            href="/cart"
            className="relative flex flex-col items-center gap-0.5 rounded-md px-2 py-1 hover:text-brand-600"
            aria-label={`Bag${bagCount ? `, ${bagCount} items` : ''}`}
          >
            <span className="relative">
              <ShoppingBag className="size-5" aria-hidden />
              <CountBadge n={bagCount} />
            </span>
            <span className="hidden text-[11px] font-semibold lg:block">Bag</span>
          </Link>
        </nav>
      </div>
      <div className="px-4 pb-2 md:hidden">
        <React.Suspense fallback={<div className="h-10 rounded-md bg-surface-2" />}>
          <SearchBox onVisualSearch={() => setVisual(true)} />
        </React.Suspense>
      </div>
      <MobileNav open={drawer} onOpenChange={setDrawer} items={nav} />
      <VisualSearchDialog open={visual} onOpenChange={setVisual} />
    </header>
  );
}
