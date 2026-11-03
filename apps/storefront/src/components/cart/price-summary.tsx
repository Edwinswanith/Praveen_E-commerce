import type { CartTotalsDto } from '@vyra/shared';
import { formatINR } from '@vyra/shared';
import { cn } from '@vyra/ui';

export function PriceSummary({
  totals,
  itemCount,
  couponCode,
  className,
  title = 'Price details',
}: {
  totals: CartTotalsDto;
  itemCount: number;
  couponCode?: string | null;
  className?: string;
  title?: string;
}) {
  const savings = totals.productDiscount + totals.couponDiscount + totals.prepaidDiscount;
  return (
    <section aria-label="Price summary" className={cn('text-sm', className)}>
      <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted">
        {title} ({itemCount} {itemCount === 1 ? 'item' : 'items'})
      </h2>
      <dl className="space-y-2.5">
        <div className="flex justify-between">
          <dt>Total MRP</dt>
          <dd className="tabular-nums">{formatINR(totals.mrpTotal)}</dd>
        </div>
        {totals.productDiscount > 0 && (
          <div className="flex justify-between">
            <dt>Discount on MRP</dt>
            <dd className="tabular-nums text-teal-600">−{formatINR(totals.productDiscount)}</dd>
          </div>
        )}
        {totals.couponDiscount > 0 && (
          <div className="flex justify-between">
            <dt>Coupon discount{couponCode ? ` (${couponCode})` : ''}</dt>
            <dd className="tabular-nums text-teal-600">−{formatINR(totals.couponDiscount)}</dd>
          </div>
        )}
        {totals.prepaidDiscount > 0 && (
          <div className="flex justify-between">
            <dt>Prepaid discount</dt>
            <dd className="tabular-nums text-teal-600">−{formatINR(totals.prepaidDiscount)}</dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt>Shipping fee</dt>
          <dd className="tabular-nums">
            {totals.shippingFee === 0 ? (
              <span className="font-semibold text-teal-600">FREE</span>
            ) : (
              formatINR(totals.shippingFee)
            )}
          </dd>
        </div>
        {totals.codFee > 0 && (
          <div className="flex justify-between">
            <dt>Cash on delivery fee</dt>
            <dd className="tabular-nums">{formatINR(totals.codFee)}</dd>
          </div>
        )}
        <div className="flex justify-between border-t border-border pt-3 text-base font-bold">
          <dt>Total amount</dt>
          <dd className="tabular-nums" data-testid="grand-total">
            {formatINR(totals.grandTotal)}
          </dd>
        </div>
      </dl>
      <p className="mt-1 text-xs text-muted">Inclusive of GST {formatINR(totals.taxTotal)}</p>
      {savings > 0 && (
        <p className="mt-3 rounded-md bg-teal-500/10 px-3 py-2 text-xs font-semibold text-teal-600">
          You’re saving {formatINR(savings)} on this order
        </p>
      )}
    </section>
  );
}

export function FreeShippingProgress({ totals }: { totals: CartTotalsDto }) {
  const threshold = totals.freeShippingThreshold;
  if (!threshold || threshold <= 0) return null;
  const net = Math.max(0, totals.subtotal - totals.couponDiscount);
  const remaining = Math.max(0, threshold - net);
  const pct = Math.min(100, Math.round((net / threshold) * 100));
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-sm" aria-live="polite">
        {remaining > 0 ? (
          <>
            Add <strong>{formatINR(remaining)}</strong> more for <strong>FREE shipping</strong>
          </>
        ) : (
          <strong className="text-teal-600">Yay! Your order ships free.</strong>
        )}
      </p>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-label="Progress to free shipping"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500',
            remaining > 0 ? 'bg-brand-500' : 'bg-teal-500',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
