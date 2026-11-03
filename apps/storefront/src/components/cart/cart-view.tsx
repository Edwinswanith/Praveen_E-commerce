'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShieldCheck, ShoppingBag } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, Button, EmptyState, Skeleton } from '@vyra/ui';
import { formatINR } from '@vyra/shared';
import { ApiError, errorMessage } from '@/lib/api';
import { useCart } from '@/hooks/use-cart';
import { CartLine } from './cart-line';
import { CouponBox } from './coupon-box';
import { FreeShippingProgress, PriceSummary } from './price-summary';

export function CartView() {
  const router = useRouter();
  const cart = useCart();
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const act = async (id: string, fn: () => Promise<unknown>, success?: string) => {
    setBusyId(id);
    try {
      await fn();
      if (success) toast.success(success);
    } catch (e) {
      toast.error(
        e instanceof ApiError && e.code === 'OUT_OF_STOCK'
          ? 'Not enough stock for that quantity.'
          : errorMessage(e),
      );
    } finally {
      setBusyId(null);
    }
  };

  if (cart.isLoading && !cart.cart) {
    return (
      <div className="grid gap-8 py-6 lg:grid-cols-[1fr_360px]" aria-busy="true">
        <div className="space-y-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }
  if (cart.error && !cart.cart) {
    return (
      <Alert tone="danger" title="We couldn’t load your bag" className="my-8">
        {errorMessage(cart.error)}{' '}
        <button className="font-semibold underline" onClick={() => void cart.refresh()}>
          Retry
        </button>
      </Alert>
    );
  }
  const c = cart.cart;
  if (!c || (c.items.length === 0 && c.savedItems.length === 0)) {
    return (
      <EmptyState
        className="py-24"
        icon={<ShoppingBag />}
        title="Your bag is empty"
        description="There’s nothing in your bag yet. Let’s add some styles that match your vibe."
        action={
          <div className="flex gap-3">
            <Button asChild>
              <Link href="/products">Start shopping</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/wishlist">View wishlist</Link>
            </Button>
          </div>
        }
      />
    );
  }

  const blocked = c.items.some((i) => !i.purchasable);
  return (
    <div className="grid gap-8 py-6 lg:grid-cols-[1fr_360px]">
      <div>
        <h1 className="font-display text-xl font-extrabold">
          Shopping bag{' '}
          <span className="text-base font-semibold text-muted">
            ({c.itemCount} {c.itemCount === 1 ? 'item' : 'items'})
          </span>
        </h1>
        {c.items.length > 0 && (
          <div className="mt-4">
            <FreeShippingProgress totals={c.totals} />
          </div>
        )}
        {blocked && (
          <Alert tone="warning" className="mt-4" title="Some items need your attention">
            Update or remove the highlighted items to continue to checkout.
          </Alert>
        )}
        {c.items.length > 0 ? (
          <ul className="mt-2 divide-y divide-border">
            {c.items.map((item) => (
              <CartLine
                key={item.id}
                item={item}
                busy={busyId === item.id}
                onQuantity={(q) => void act(item.id, () => cart.updateQuantity(item.id, q))}
                onRemove={() =>
                  void act(item.id, () => cart.removeItem(item.id), 'Removed from bag')
                }
                onSave={() =>
                  void act(item.id, () => cart.saveForLater(item.id), 'Saved for later')
                }
              />
            ))}
          </ul>
        ) : (
          <p className="mt-6 text-sm text-muted">
            No items in your bag. Move something from “Saved for later” below.
          </p>
        )}
        {c.savedItems.length > 0 && (
          <section aria-labelledby="saved-heading" className="mt-8 border-t border-border pt-6">
            <h2 id="saved-heading" className="font-display text-base font-extrabold">
              Saved for later ({c.savedItems.length})
            </h2>
            <ul className="divide-y divide-border">
              {c.savedItems.map((item) => (
                <CartLine
                  key={item.id}
                  item={item}
                  busy={busyId === item.id}
                  onRemove={() => void act(item.id, () => cart.removeItem(item.id), 'Removed')}
                  onMove={() => void act(item.id, () => cart.moveToCart(item.id), 'Moved to bag')}
                />
              ))}
            </ul>
          </section>
        )}
      </div>

      {c.items.length > 0 && (
        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <CouponBox
            code={c.couponCode}
            autoApplied={c.couponAutoApplied}
            error={c.couponError}
            onApply={cart.applyCoupon}
            onRemove={cart.removeCoupon}
          />
          <div className="border-t border-border pt-6">
            <PriceSummary
              totals={c.totals}
              itemCount={c.itemCount}
              couponCode={c.couponCode}
              couponAutoApplied={c.couponAutoApplied}
            />
          </div>
          <div className="sticky bottom-0 -mx-4 border-t border-border bg-bg px-4 py-3 lg:static lg:mx-0 lg:border-0 lg:p-0">
            <div className="mb-2 flex items-center justify-between lg:hidden">
              <span className="text-sm text-muted">Total</span>
              <strong>{formatINR(c.totals.grandTotal)}</strong>
            </div>
            <Button size="lg" block disabled={blocked} onClick={() => router.push('/checkout')}>
              Place order
            </Button>
          </div>
          <p className="flex items-center gap-2 text-xs text-muted">
            <ShieldCheck className="size-4" aria-hidden />
            Safe and secure payments. 100% authentic products.
          </p>
        </aside>
      )}
    </div>
  );
}
