'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as DM from '@radix-ui/react-dropdown-menu';
import { LogOut, MapPin, Package, RotateCcw, Truck, User } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { userContact } from '@/lib/format';

const itemCls =
  'flex cursor-pointer items-center gap-2.5 rounded-sm px-3 py-2 text-sm text-fg outline-none data-[highlighted]:bg-surface-2';

export function AccountMenu() {
  const { user, logout } = useAuth();
  const router = useRouter();
  return (
    <DM.Root>
      <DM.Trigger
        className="flex flex-col items-center gap-0.5 rounded-md px-2 py-1 text-fg hover:text-brand-600 data-[state=open]:text-brand-600"
        aria-label={user ? `Account menu for ${user.name}` : 'Account menu'}
      >
        <User className="size-5" aria-hidden />
        <span className="hidden text-[11px] font-semibold lg:block">
          {user ? user.name.split(' ')[0] : 'Profile'}
        </span>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content
          align="end"
          sideOffset={8}
          className="z-50 w-64 rounded-md border border-border bg-bg p-1.5 shadow-pop"
        >
          {user ? (
            <>
              <div className="px-3 py-2">
                <p className="text-sm font-bold">Hello, {user.name.split(' ')[0]}</p>
                <p className="truncate text-xs text-muted">{userContact(user)}</p>
              </div>
              <DM.Separator className="my-1 h-px bg-border" />
              <DM.Item asChild className={itemCls}>
                <Link href="/account/orders">
                  <Package className="size-4" aria-hidden />
                  Orders
                </Link>
              </DM.Item>
              <DM.Item asChild className={itemCls}>
                <Link href="/account/returns">
                  <RotateCcw className="size-4" aria-hidden />
                  Returns
                </Link>
              </DM.Item>
              <DM.Item asChild className={itemCls}>
                <Link href="/account/addresses">
                  <MapPin className="size-4" aria-hidden />
                  Addresses
                </Link>
              </DM.Item>
              <DM.Item asChild className={itemCls}>
                <Link href="/account">
                  <User className="size-4" aria-hidden />
                  Profile
                </Link>
              </DM.Item>
              <DM.Separator className="my-1 h-px bg-border" />
              <DM.Item
                className={itemCls}
                onSelect={async () => {
                  await logout();
                  toast.success('Signed out');
                  router.push('/');
                }}
              >
                <LogOut className="size-4" aria-hidden />
                Sign out
              </DM.Item>
            </>
          ) : (
            <>
              <div className="px-3 py-2">
                <p className="text-sm font-bold">Welcome to VYRA</p>
                <p className="text-xs text-muted">Sign in to track orders and save favourites.</p>
              </div>
              <div className="flex gap-2 px-3 pb-2 pt-1">
                <DM.Item
                  asChild
                  className="flex h-9 flex-1 items-center justify-center rounded-md bg-brand-500 text-xs font-semibold uppercase text-white outline-none data-[highlighted]:bg-brand-600"
                >
                  <Link href="/login">Sign in</Link>
                </DM.Item>
                <DM.Item
                  asChild
                  className="flex h-9 flex-1 items-center justify-center rounded-md border border-border-strong text-xs font-semibold uppercase outline-none data-[highlighted]:border-fg"
                >
                  <Link href="/register">Join</Link>
                </DM.Item>
              </div>
              <DM.Separator className="my-1 h-px bg-border" />
              <DM.Item asChild className={itemCls}>
                <Link href="/track">
                  <Truck className="size-4" aria-hidden />
                  Track an order
                </Link>
              </DM.Item>
            </>
          )}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
