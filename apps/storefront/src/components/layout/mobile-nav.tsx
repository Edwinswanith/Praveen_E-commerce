'use client';

import Link from 'next/link';
import * as Accordion from '@radix-ui/react-accordion';
import { ChevronDown, Heart, Package, ShoppingBag, Truck, User } from 'lucide-react';
import { VyraLogo } from '@vyra/ui';
import type { NavCategory } from '@/lib/categories';
import { useAuth } from '@/hooks/use-auth';
import { Sheet } from '../ui/dialog';

export function MobileNav({
  open,
  onOpenChange,
  items,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  items: NavCategory[];
}) {
  const { user } = useAuth();
  const close = () => onOpenChange(false);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      side="left"
      title={<VyraLogo className="text-xl" />}
    >
      <div className="flex flex-col">
        <div className="border-b border-border bg-surface px-5 py-4">
          {user ? (
            <p className="text-sm">
              Hi <strong>{user.name.split(' ')[0]}</strong> —{' '}
              <Link href="/account" onClick={close} className="font-semibold text-brand-600">
                My account
              </Link>
            </p>
          ) : (
            <p className="text-sm">
              <Link href="/login" onClick={close} className="font-semibold text-brand-600">
                Sign in
              </Link>{' '}
              or{' '}
              <Link href="/register" onClick={close} className="font-semibold text-brand-600">
                create an account
              </Link>
            </p>
          )}
        </div>
        <Accordion.Root type="single" collapsible className="divide-y divide-border">
          {items.map((top) => (
            <Accordion.Item key={top.id} value={top.id}>
              {top.children.length > 0 ? (
                <>
                  <Accordion.Header>
                    <Accordion.Trigger className="group flex w-full items-center justify-between px-5 py-4 text-sm font-bold uppercase tracking-wider">
                      {top.name}
                      <ChevronDown
                        className="size-4 transition-transform group-data-[state=open]:rotate-180"
                        aria-hidden
                      />
                    </Accordion.Trigger>
                  </Accordion.Header>
                  <Accordion.Content className="bg-surface px-5 pb-3">
                    <ul className="space-y-1">
                      <li>
                        <Link
                          href={top.href}
                          onClick={close}
                          className="block py-2 text-sm font-semibold text-brand-600"
                        >
                          All {top.name}
                        </Link>
                      </li>
                      {top.children.map((c) => (
                        <li key={c.id}>
                          <Link
                            href={c.href}
                            onClick={close}
                            className="block py-2 text-sm font-semibold"
                          >
                            {c.name}
                          </Link>
                          {c.children.length > 0 && (
                            <ul className="mb-1 ml-3 border-l border-border pl-3">
                              {c.children.map((l) => (
                                <li key={l.id}>
                                  <Link
                                    href={l.href}
                                    onClick={close}
                                    className="block py-1.5 text-sm text-muted"
                                  >
                                    {l.name}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  </Accordion.Content>
                </>
              ) : (
                <Link
                  href={top.href}
                  onClick={close}
                  className="block px-5 py-4 text-sm font-bold uppercase tracking-wider"
                >
                  {top.name}
                </Link>
              )}
            </Accordion.Item>
          ))}
        </Accordion.Root>
        <ul className="mt-2 space-y-1 border-t border-border px-5 py-4 text-sm">
          {[
            { href: '/account/orders', label: 'Orders', icon: Package },
            { href: '/wishlist', label: 'Wishlist', icon: Heart },
            { href: '/cart', label: 'Bag', icon: ShoppingBag },
            { href: '/track', label: 'Track an order', icon: Truck },
            { href: '/account', label: 'Account', icon: User },
          ].map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link href={href} onClick={close} className="flex items-center gap-3 py-2">
                <Icon className="size-4 text-muted" aria-hidden />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}
