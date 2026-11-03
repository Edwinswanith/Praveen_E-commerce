'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { ArrowLeft, RotateCcw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { OrderDetailDto, ReturnRequestDto } from '@vyra/shared';
import { cancelOrderSchema, returnRequestSchema } from '@vyra/shared';
import { Alert, Badge, Button, Field, Skeleton, Textarea, cn } from '@vyra/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDate, RETURN_REASONS, RETURN_STATUS_LABEL, RETURN_STATUS_TONE } from '@/lib/format';
import { recallCodOtp, type CodOtpHint } from '@/lib/checkout-session';
import { ExchangePicker, exchangeOptionsFor } from './exchange-picker';
import { CodConfirmCard } from '../checkout/cod-confirm-card';
import { Modal } from '../ui/dialog';
import { NativeSelect } from '../ui/select';
import { QuantityStepper } from '../ui/quantity-stepper';
import { PayNowButton } from '../checkout/pay-now';
import {
  OrderItems,
  OrderStatusBadge,
  OrderTimeline,
  OrderTotals,
  PaymentLine,
  ShipmentCard,
  ShippingAddress,
} from './order-parts';

function CancelDialog({
  order,
  open,
  onOpenChange,
  onDone,
}: {
  order: OrderDetailDto;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: (o: OrderDetailDto) => void;
}) {
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const submit = async () => {
    const parsed = cancelOrderSchema.safeParse({ reason });
    if (!parsed.success) {
      setError('Please tell us why (at least 3 characters).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await api<OrderDetailDto>(
        `/orders/${encodeURIComponent(order.number)}/cancel`,
        { method: 'POST', body: parsed.data },
      );
      toast.success('Order cancelled');
      onDone(updated);
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Cancel order ${order.number}?`}
      description={
        order.paymentStatus === 'CAPTURED'
          ? 'Your payment will be refunded to the original method.'
          : undefined
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Keep order
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void submit()}>
            Cancel order
          </Button>
        </div>
      }
    >
      <div className="p-5">
        <Field label="Reason for cancellation" htmlFor="cancel-reason" error={error ?? undefined}>
          <Textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            placeholder="e.g. Ordered the wrong size"
            invalid={!!error}
          />
        </Field>
      </div>
    </Modal>
  );
}

type RequestType = 'RETURN' | 'EXCHANGE';

export function ReturnDialog({
  order,
  open,
  onOpenChange,
  onDone,
}: {
  order: OrderDetailDto;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const returnable = order.items.filter((i) => i.quantity - i.returnedQuantity > 0);
  const exchangeable = returnable.filter((i) => exchangeOptionsFor(order, i.id).length > 0);
  const [type, setType] = React.useState<RequestType>('RETURN');
  const [qty, setQty] = React.useState<Record<string, number>>({});
  const [targets, setTargets] = React.useState<Record<string, string>>({});
  const [reason, setReason] = React.useState<string>('SIZE_ISSUE');
  const [comments, setComments] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [missing, setMissing] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const listed = type === 'EXCHANGE' ? exchangeable : returnable;

  const switchType = (t: RequestType) => {
    setType(t);
    setError(null);
    setMissing(new Set());
    if (t === 'EXCHANGE') {
      // Drop selections that can't be exchanged.
      setQty((q) =>
        Object.fromEntries(Object.entries(q).filter(([id]) => exchangeable.some((i) => i.id === id))),
      );
    }
  };

  const submit = async () => {
    const items = Object.entries(qty)
      .filter(([id, q]) => q > 0 && listed.some((i) => i.id === id))
      .map(([orderItemId, quantity]) => ({
        orderItemId,
        quantity,
        ...(type === 'EXCHANGE' && targets[orderItemId]
          ? { exchangeVariantId: targets[orderItemId] }
          : {}),
      }));
    if (items.length === 0) {
      setError(`Select at least one item to ${type === 'EXCHANGE' ? 'exchange' : 'return'}.`);
      return;
    }
    if (type === 'EXCHANGE') {
      const lacking = new Set(items.filter((i) => !i.exchangeVariantId).map((i) => i.orderItemId));
      setMissing(lacking);
      if (lacking.size > 0) {
        setError('Choose the size/colour you want for each exchanged item.');
        return;
      }
    }
    const parsed = returnRequestSchema.safeParse({
      orderId: order.id,
      type,
      reason,
      comments: comments.trim() || undefined,
      items,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please check the form');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api<ReturnRequestDto>('/returns', { method: 'POST', body: parsed.data });
      toast.success(
        type === 'EXCHANGE'
          ? 'Exchange requested. We’ll ship your new size once we pick up the original.'
          : 'Return requested. We’ll email you the pickup details.',
      );
      onDone();
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={type === 'EXCHANGE' ? 'Exchange items' : 'Request a return'}
      description={
        type === 'EXCHANGE'
          ? 'Pick the items and the size/colour you’d like instead. Exchanges are free.'
          : 'Select the items and quantities you’d like to return.'
      }
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            {type === 'EXCHANGE' ? 'Request exchange' : 'Submit return'}
          </Button>
        </div>
      }
    >
      <div className="space-y-5 p-5">
        {exchangeable.length > 0 && (
          <fieldset>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              What would you like?
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ['EXCHANGE', 'Exchange for another size/colour', 'Same price, no refund needed'],
                  ['RETURN', 'Return for refund', 'Refund to your original payment method'],
                ] as const
              ).map(([value, label, hint]) => (
                <label
                  key={value}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-300',
                    type === value ? 'border-brand-500 bg-brand-50/50' : 'border-border-strong',
                  )}
                >
                  <input
                    type="radio"
                    name="return-type"
                    value={value}
                    checked={type === value}
                    onChange={() => switchType(value)}
                    className="mt-1 size-4 accent-brand-500"
                  />
                  <span>
                    <span className="block font-semibold">{label}</span>
                    <span className="text-xs text-muted">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Items
          </legend>
          <ul className="divide-y divide-border rounded-md border border-border">
            {listed.map((i) => {
              const max = i.quantity - i.returnedQuantity;
              const value = qty[i.id] ?? 0;
              const options = exchangeOptionsFor(order, i.id);
              return (
                <li key={i.id} className="p-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id={`ret-${i.id}`}
                      checked={value > 0}
                      onChange={(e) => setQty((q) => ({ ...q, [i.id]: e.target.checked ? 1 : 0 }))}
                      className="size-4 accent-brand-500"
                    />
                    <label htmlFor={`ret-${i.id}`} className="min-w-0 flex-1 text-sm">
                      <span className="block truncate font-semibold">{i.name}</span>
                      <span className="text-xs text-muted">
                        {i.color} · {i.size} · up to {max}
                      </span>
                    </label>
                    {value > 0 && max > 1 && (
                      <QuantityStepper
                        value={value}
                        min={1}
                        max={max}
                        onChange={(n) => setQty((q) => ({ ...q, [i.id]: n }))}
                        label={`${type === 'EXCHANGE' ? 'Exchange' : 'Return'} quantity for ${i.name}`}
                      />
                    )}
                  </div>
                  {type === 'EXCHANGE' && value > 0 && (
                    <div className="pl-7">
                      <ExchangePicker
                        itemId={i.id}
                        itemName={i.name}
                        current={{ color: i.color, size: i.size }}
                        options={options}
                        value={targets[i.id] ?? null}
                        onChange={(variantId) => {
                          setTargets((t) => ({ ...t, [i.id]: variantId }));
                          setMissing((m) => {
                            const n = new Set(m);
                            n.delete(i.id);
                            return n;
                          });
                        }}
                        error={missing.has(i.id) ? 'Choose a size/colour' : null}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {type === 'EXCHANGE' && exchangeable.length < returnable.length && (
            <p className="mt-2 text-xs text-muted">
              Items with no other size/colour in stock at the same price can only be returned.
            </p>
          )}
        </fieldset>
        <Field label="Reason" htmlFor="ret-reason">
          <NativeSelect id="ret-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
            {RETURN_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Comments (optional)" htmlFor="ret-comments">
          <Textarea
            id="ret-comments"
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            maxLength={1000}
          />
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}

/** Full order view shared by the account page and guest tracking (actions only when signed in). */
export function OrderView({
  order,
  actions,
  onChange,
}: {
  order: OrderDetailDto;
  actions?: boolean;
  onChange?: (o?: OrderDetailDto) => void;
}) {
  const [cancel, setCancel] = React.useState(false);
  const [ret, setRet] = React.useState(false);
  const [codHint, setCodHint] = React.useState<CodOtpHint | null>(null);
  React.useEffect(() => setCodHint(recallCodOtp(order.number)), [order.number]);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-xl font-extrabold">Order {order.number}</h1>
            <OrderStatusBadge status={order.status} />
          </div>
          <p className="mt-1 text-sm text-muted">
            Placed on {formatDate(order.createdAt)} ·{' '}
            {order.shippingMethod === 'EXPRESS' ? 'Express' : 'Standard'} delivery
          </p>
          {order.exchangeForOrderNumber && (
            <p className="mt-1 text-sm">
              Replacement for order{' '}
              {actions ? (
                <Link
                  href={`/account/orders/${encodeURIComponent(order.exchangeForOrderNumber)}`}
                  className="font-semibold text-brand-600 hover:underline"
                >
                  {order.exchangeForOrderNumber}
                </Link>
              ) : (
                <strong>{order.exchangeForOrderNumber}</strong>
              )}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap gap-2">
            {order.status === 'PENDING_PAYMENT' && order.paymentMethod === 'ONLINE' && (
              <PayNowButton order={order} onPaid={(o) => onChange?.(o)} />
            )}
            {order.canCancel && (
              <Button variant="outline" size="sm" onClick={() => setCancel(true)}>
                <XCircle aria-hidden />
                Cancel order
              </Button>
            )}
            {order.canReturn && (
              <Button variant="outline" size="sm" onClick={() => setRet(true)}>
                <RotateCcw aria-hidden />
                {order.exchangeOptions && Object.values(order.exchangeOptions).some((o) => o.length > 0)
                  ? 'Return / exchange'
                  : 'Return items'}
              </Button>
            )}
          </div>
        )}
      </div>
      {order.status === 'RTO' && (
        <Alert tone="danger" title="Returned to sender">
          The courier couldn’t deliver this order and it was returned to us.
          {order.paymentMethod === 'ONLINE' && ' Any payment will be refunded to the original method.'}
        </Alert>
      )}
      {order.paymentMethod === 'COD' &&
        order.codConfirmation === 'PENDING' &&
        order.status !== 'CANCELLED' && (
          <CodConfirmCard
            key={codHint?.sentAt ?? 'no-hint'}
            order={order}
            hint={codHint}
            onConfirmed={(o) => onChange?.(o)}
            onStale={() => onChange?.()}
          />
        )}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <div className="rounded-lg border border-border p-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted">Items</h2>
            <OrderItems order={order} />
          </div>
          {order.returns.length > 0 && (
            <div className="rounded-lg border border-border p-4">
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">
                Returns
              </h2>
              <ul className="space-y-3 text-sm">
                {order.returns.map((r) => (
                  <li key={r.id}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">
                        {r.type === 'EXCHANGE' ? 'Exchange' : 'Return'}
                      </span>
                      <Badge tone={RETURN_STATUS_TONE[r.status]}>
                        {RETURN_STATUS_LABEL[r.status]}
                      </Badge>
                    </div>
                    <ul className="mt-1 text-sm">
                      {r.items.map((i) => (
                        <li key={i.orderItemId}>
                          {i.name} ×{i.quantity}
                          {i.exchangeFor && (
                            <span className="text-muted">
                              {' '}
                              → {i.exchangeFor.color} · {i.exchangeFor.size}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                    {r.replacementOrderNumber && (
                      <p className="mt-1 text-xs">
                        Replacement order{' '}
                        <Link
                          href={`/account/orders/${encodeURIComponent(r.replacementOrderNumber)}`}
                          className="font-semibold text-brand-600 hover:underline"
                        >
                          {r.replacementOrderNumber}
                        </Link>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid gap-6 rounded-lg border border-border p-4 sm:grid-cols-2">
            <div>
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">
                Delivery address
              </h2>
              <ShippingAddress order={order} />
              <div className="mt-3">
                <PaymentLine order={order} />
              </div>
            </div>
            <OrderTotals order={order} />
          </div>
          {order.refunds.length > 0 && (
            <Alert tone="info" title="Refunds">
              <ul>
                {order.refunds.map((r) => (
                  <li key={r.id}>
                    ₹{r.amount} — {r.status.toLowerCase()} ({formatDate(r.createdAt)})
                  </li>
                ))}
              </ul>
            </Alert>
          )}
        </div>
        <div className="space-y-6">
          <div className="rounded-lg border border-border p-4">
            <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-muted">Tracking</h2>
            <OrderTimeline order={order} />
          </div>
          <ShipmentCard order={order} />
        </div>
      </div>
      {actions && (
        <CancelDialog
          order={order}
          open={cancel}
          onOpenChange={setCancel}
          onDone={(o) => onChange?.(o)}
        />
      )}
      {actions && (
        <ReturnDialog order={order} open={ret} onOpenChange={setRet} onDone={() => onChange?.()} />
      )}
    </div>
  );
}

export function OrderDetailPage({ number }: { number: string }) {
  const key = `/orders/${encodeURIComponent(number)}`;
  const { data, error, isLoading, mutate } = useSWR<OrderDetailDto>(key);
  return (
    <div className="space-y-4">
      <Link
        href="/account/orders"
        className="inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-fg"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All orders
      </Link>
      {isLoading && <Skeleton className="h-96" />}
      {error && <Alert tone="danger">{errorMessage(error, 'Order not found')}</Alert>}
      {data && (
        <OrderView
          order={data}
          actions
          onChange={(o) => void (o ? mutate(o, { revalidate: true }) : mutate())}
        />
      )}
    </div>
  );
}
