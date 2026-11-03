'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Heart, MapPin, Package, RotateCcw, User } from 'lucide-react';
import { Spinner, cn } from '@vyra/ui';
import { useRequireAuth } from '@/hooks/use-require-auth';

const NAV = [
  { href: '/account', label: 'Profile', icon: User, exact: true },
  { href: '/account/orders', label: 'Orders', icon: Package },
  { href: '/account/returns', label: 'Returns', icon: RotateCcw },
  { href: '/account/addresses', label: 'Addresses', icon: MapPin },
  { href: '/wishlist', label: 'Wishlist', icon: Heart },
];

/** Client-side guard + account navigation. */
export function AccountShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useRequireAuth();
  const pathname = usePathname();
  if (loading || !user) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" aria-busy="true">
        <Spinner />
      </div>
    );
  }
  return (
    <div className="grid gap-6 py-6 lg:grid-cols-[220px_1fr] lg:gap-10">
      <aside>
        <p className="hidden text-sm lg:block">
          <span className="text-muted">Hello,</span>
          <br />
          <strong className="text-base">{user.name}</strong>
        </p>
        <nav
          aria-label="Account"
          className="-mx-4 mt-0 flex gap-1 overflow-x-auto px-4 scrollbar-none lg:mx-0 lg:mt-6 lg:flex-col lg:px-0"
        >
          {NAV.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold',
                  active
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-muted hover:bg-surface-2 hover:text-fg',
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
