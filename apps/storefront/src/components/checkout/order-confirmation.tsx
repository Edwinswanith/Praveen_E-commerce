'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { CheckCircle2, Clock, ShieldAlert } from 'lucide-react';
import type { OrderDetailDto } from '@vyra/shared';
import { Alert, Button, Skeleton } from '@vyra/ui';
import { recallCodOtp, recallOrder, rememberOrder, type CodOtpHint } from '@/lib/checkout-session';
import { CodConfirmCard } from './cod-confirm-card';
import { PayNowButton } from './pay-now';
import { useAuth } from '@/hooks/use-auth';
import { OrderItems, OrderTotals, PaymentLine, ShippingAddress } from '../account/order-parts';

export function OrderConfirmation({ number }: { number: string }) {
  const { user, loading } = useAuth();
  const [cached, setCached] = React.useState<OrderDetailDto | null | undefined>(undefined);
  const [codHint, setCodHint] = React.useState<CodOtpHint | null>(null);
  React.useEffect(() => {
    setCached(recallOrder(number));
    setCodHint(recallCodOtp(number));
  }, [number]);
  const {
    data: fetched,
    error,
    mutate,
  } = useSWR<OrderDetailDto>(user ? `/orders/${encodeURIComponent(number)}` : null);
  const order = fetched ?? cached ?? null;

  if (cached === undefined || (loading && !order)) return <Skeleton className="h-96 w-full" />;
  if (!order) {
    return (
      <Alert tone={error ? 'danger' : 'info'} title={`Order ${number}`}>
        {user
          ? 'We couldn’t load this order.'
          : 'Your order was placed. Track it any time with your order number and email or phone.'}{' '}
        <Link
          href={`/track?number=${encodeURIComponent(number)}`}
          className="font-semibold underline"
        >
          Track order
        </Link>
      </Alert>
    );
  }
  const pending = order.status === 'PENDING_PAYMENT';
  const codPending =
    order.paymentMethod === 'COD' &&
    order.codConfirmation === 'PENDING' &&
    order.status !== 'CANCELLED';
  const onUpdated = (o: OrderDetailDto) => {
    rememberOrder(o);
    setCached(o);
    if (user) void mutate(o, { revalidate: true });
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center text-center">
        {pending ? (
          <Clock className="size-14 text-warning" aria-hidden />
        ) : codPending ? (
          <ShieldAlert className="size-14 text-brand-500" aria-hidden />
        ) : (
          <CheckCircle2 className="size-14 text-teal-500" aria-hidden />
        )}
        <h1 className="mt-3 font-display text-2xl font-extrabold">
          {pending ? 'Awaiting payment' : codPending ? 'One last step' : 'Order confirmed!'}
        </h1>
        <p className="mt-1 text-sm text-muted">
          Order <strong className="text-fg">{order.number}</strong> · Confirmation sent to{' '}
          {order.customerEmail}
        </p>
      </div>
      {codPending && (
        <CodConfirmCard
          key={codHint?.sentAt ?? 'no-hint'}
          order={order}
          hint={codHint}
          onConfirmed={onUpdated}
          onStale={() => void (user ? mutate() : undefined)}
        />
      )}
      {pending && (
        <Alert tone="warning">
          We haven’t received your payment yet. If money was debited it will be confirmed
          automatically within a few minutes.
          {user && order.paymentMethod === 'ONLINE' && (
            <div className="mt-3">
              <PayNowButton
                order={order}
                onPaid={onUpdated}
              />
            </div>
          )}
        </Alert>
      )}
      <div className="grid gap-6 rounded-lg border border-border p-5 sm:grid-cols-2">
        <div>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">
            Delivering to
          </h2>
          <ShippingAddress order={order} />
          <div className="mt-3">
            <PaymentLine order={order} />
          </div>
        </div>
        <OrderTotals order={order} />
      </div>
      <div className="rounded-lg border border-border p-5">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted">Items</h2>
        <OrderItems order={order} />
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        {user ? (
          <Button asChild>
            <Link href={`/account/orders/${encodeURIComponent(order.number)}`}>View order</Link>
          </Button>
        ) : (
          <Button asChild>
            <Link href={`/track?number=${encodeURIComponent(order.number)}`}>Track order</Link>
          </Button>
        )}
        <Button asChild variant="outline">
          <Link href="/products">Continue shopping</Link>
        </Button>
      </div>
    </div>
  );
}
