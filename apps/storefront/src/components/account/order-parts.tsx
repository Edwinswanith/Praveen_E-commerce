import Link from 'next/link';
import { Check, ExternalLink, Package } from 'lucide-react';
import type { OrderDetailDto, OrderStatus } from '@vyra/shared';
import { formatINR } from '@vyra/shared';
import { Badge, cn } from '@vyra/ui';
import {
  formatDate,
  formatDateTime,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  PAYMENT_STATUS_LABEL,
} from '@/lib/format';
import { ProductImage } from '../product/product-image';
import { PriceSummary } from '../cart/price-summary';

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={ORDER_STATUS_TONE[status]}>{ORDER_STATUS_LABEL[status]}</Badge>;
}

const FLOW: OrderStatus[] = ['CONFIRMED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'];

/** Progress timeline built from the order's events (falls back to the canonical flow for steps not reached yet). */
export function OrderTimeline({ order }: { order: OrderDetailDto }) {
  const events = [...order.events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const terminal =
    order.status === 'CANCELLED' || order.status === 'RETURNED' || order.status === 'RTO';
  const reachedIdx = FLOW.indexOf(order.status);
  const steps = terminal
    ? events.map((e) => ({ status: e.status, at: e.createdAt, note: e.note, done: true }))
    : [
        ...(order.status === 'PENDING_PAYMENT'
          ? [
              {
                status: 'PENDING_PAYMENT' as OrderStatus,
                at:
                  events.find((e) => e.status === 'PENDING_PAYMENT')?.createdAt ?? order.createdAt,
                note: null,
                done: true,
              },
            ]
          : []),
        ...FLOW.map((s, i) => {
          const ev = [...events].reverse().find((e) => e.status === s);
          return {
            status: s,
            at: ev?.createdAt ?? null,
            note: ev?.note ?? null,
            done: !!ev || (reachedIdx >= 0 && i <= reachedIdx),
          };
        }),
      ];
  return (
    <ol className="relative space-y-5 border-l-2 border-border pl-6" aria-label="Order progress">
      {steps.map((s, i) => (
        <li key={`${s.status}-${i}`} className="relative">
          <span
            className={cn(
              'absolute -left-[33px] top-0.5 flex size-4 items-center justify-center rounded-full ring-4 ring-bg',
              s.done
                ? s.status === 'CANCELLED' || s.status === 'RTO'
                  ? 'bg-danger'
                  : 'bg-teal-500'
                : 'bg-border-strong',
            )}
          >
            {s.done && <Check className="size-2.5 text-white" strokeWidth={4} aria-hidden />}
          </span>
          <p className={cn('text-sm font-semibold', !s.done && 'text-muted')}>
            {ORDER_STATUS_LABEL[s.status]}
          </p>
          {s.at && <p className="text-xs text-muted">{formatDateTime(s.at)}</p>}
          {s.note && <p className="mt-0.5 text-xs text-fg/80">{s.note}</p>}
          {s.status === 'RTO' && (
            <p className="mt-0.5 text-xs text-muted">
              The courier couldn’t deliver this parcel and it was returned to us.
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

export function ShipmentCard({ order }: { order: OrderDetailDto }) {
  const s = order.shipment;
  if (!s) return null;
  return (
    <div className="rounded-lg border border-border p-4">
      <h3 className="flex items-center gap-2 text-sm font-bold">
        <Package className="size-4" aria-hidden />
        Shipment
      </h3>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
        {s.courierName && (
          <>
            <dt className="text-muted">Courier</dt>
            <dd>{s.courierName}</dd>
          </>
        )}
        {s.trackingNumber && (
          <>
            <dt className="text-muted">Tracking no.</dt>
            <dd className="font-mono text-xs">{s.trackingNumber}</dd>
          </>
        )}
        <dt className="text-muted">Status</dt>
        <dd>
          {s.status
            .replace(/_/g, ' ')
            .toLowerCase()
            .replace(/^\w/, (c) => c.toUpperCase())}
        </dd>
        {s.shippedAt && (
          <>
            <dt className="text-muted">Shipped</dt>
            <dd>{formatDate(s.shippedAt)}</dd>
          </>
        )}
        {s.deliveredAt && (
          <>
            <dt className="text-muted">Delivered</dt>
            <dd>{formatDate(s.deliveredAt)}</dd>
          </>
        )}
      </dl>
      {s.trackingUrl && (
        <a
          href={s.trackingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline"
        >
          Track with courier <ExternalLink className="size-3.5" aria-hidden />
        </a>
      )}
      {s.events.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-border pt-3 text-xs">
          {[...s.events]
            .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
            .map((e, i) => (
              <li key={i}>
                <p className="font-semibold">{e.description ?? e.status}</p>
                <p className="text-muted">
                  {[e.location, formatDateTime(e.occurredAt)].filter(Boolean).join(' · ')}
                </p>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

export function OrderItems({ order }: { order: OrderDetailDto }) {
  return (
    <ul className="divide-y divide-border">
      {order.items.map((i) => (
        <li key={i.id} className="flex gap-3 py-3">
          <Link
            href={`/p/${i.productSlug}`}
            className="relative aspect-[3/4] w-16 shrink-0 overflow-hidden rounded-md bg-surface-2"
          >
            <ProductImage
              src={i.imageUrl}
              alt={i.name}
              fill
              sizes="64px"
              className="object-cover"
            />
          </Link>
          <div className="min-w-0 flex-1 text-sm">
            <Link href={`/p/${i.productSlug}`} className="font-semibold hover:underline">
              {i.name}
            </Link>
            <p className="text-xs text-muted">
              {i.color} · Size {i.size} · Qty {i.quantity}
            </p>
            {i.returnedQuantity > 0 && (
              <p className="text-xs text-warning">{i.returnedQuantity} returned</p>
            )}
          </div>
          <p className="text-sm font-semibold tabular-nums">{formatINR(i.lineTotal)}</p>
        </li>
      ))}
    </ul>
  );
}

/** Where the order's savings came from, from the order's discount ledger. */
export function orderSavingsLines(order: OrderDetailDto): { label: string; amount: number }[] {
  const sv = order.savings ?? { campaign: 0, promotion: 0, coupon: 0, prepaid: 0 };
  const productDiscount = Math.max(0, order.mrpTotal - order.subtotal);
  const rows = [
    { label: 'Discount on MRP', amount: Math.max(0, productDiscount - sv.campaign) },
    { label: 'Sale prices', amount: sv.campaign },
    { label: 'Bundle offer', amount: sv.promotion },
    { label: order.couponCode ? `Coupon ${order.couponCode}` : 'Coupon', amount: sv.coupon },
    { label: 'Paying online', amount: sv.prepaid },
  ];
  return rows.filter((r) => r.amount > 0);
}

export function OrderSavings({ order }: { order: OrderDetailDto }) {
  const lines = orderSavingsLines(order);
  if (lines.length === 0) return null;
  const total = lines.reduce((s, l) => s + l.amount, 0);
  return (
    <section
      aria-label="Your savings"
      className="mt-3 rounded-md bg-teal-500/10 px-3 py-2 text-xs text-teal-700"
      data-testid="order-savings"
    >
      <p className="font-semibold">You saved {formatINR(total)} on this order</p>
      <dl className="mt-1 space-y-0.5">
        {lines.map((l) => (
          <div key={l.label} className="flex justify-between gap-3">
            <dt>{l.label}</dt>
            <dd className="tabular-nums">{formatINR(l.amount)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function OrderTotals({ order }: { order: OrderDetailDto }) {
  const productDiscount = Math.max(0, order.mrpTotal - order.subtotal);
  return (
    <div>
      <PriceSummary
        title="Payment summary"
        itemCount={order.itemCount}
        couponCode={order.couponCode}
        showSavingsNote={false}
        totals={{
          mrpTotal: order.mrpTotal,
          subtotal: order.subtotal,
          productDiscount,
          couponDiscount: order.couponDiscount,
          promotionDiscount: order.promotionDiscount ?? 0,
          promotionName: null,
          campaignSavings: order.savings?.campaign ?? 0,
          offerNote: null,
          prepaidDiscount: order.prepaidDiscount,
          prepaidSavings: 0,
          shippingFee: order.shippingFee,
          codFee: order.codFee,
          taxTotal: order.taxTotal,
          grandTotal: order.grandTotal,
          codAvailable: order.paymentMethod === 'COD',
          codUnavailableReason: null,
          freeShippingThreshold: 0,
        }}
      />
      <OrderSavings order={order} />
    </div>
  );
}

export function PaymentLine({ order }: { order: OrderDetailDto }) {
  return (
    <p className="text-sm">
      <span className="text-muted">Payment: </span>
      {order.paymentMethod === 'COD' ? 'Cash on delivery' : 'Online'}
      {order.paymentMethod === 'COD' && order.codConfirmation === 'PENDING' && (
        <span className="text-warning"> · Awaiting your confirmation</span>
      )}
      {order.paymentStatus && (
        <span className="text-muted"> · {PAYMENT_STATUS_LABEL[order.paymentStatus]}</span>
      )}
    </p>
  );
}

export function ShippingAddress({ order }: { order: OrderDetailDto }) {
  const a = order.shippingAddress;
  return (
    <div className="text-sm">
      <p className="font-semibold">{a.fullName}</p>
      <p className="text-muted">{[a.line1, a.line2, a.landmark].filter(Boolean).join(', ')}</p>
      <p className="text-muted">
        {a.city}, {a.state} — {a.pincode}
      </p>
      <p className="text-muted">{a.phone}</p>
    </div>
  );
}
