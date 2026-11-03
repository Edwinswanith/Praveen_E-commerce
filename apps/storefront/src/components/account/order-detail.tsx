'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { ArrowLeft, RotateCcw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { OrderDetailDto, ReturnRequestDto } from '@vyra/shared';
import { cancelOrderSchema, returnRequestSchema } from '@vyra/shared';
import { Alert, Badge, Button, Field, Skeleton, Textarea } from '@vyra/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDate, RETURN_REASONS, RETURN_STATUS_LABEL } from '@/lib/format';
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

function ReturnDialog({
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
  const [qty, setQty] = React.useState<Record<string, number>>({});
  const [reason, setReason] = React.useState<string>('SIZE_ISSUE');
  const [comments, setComments] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const submit = async () => {
    const items = Object.entries(qty)
      .filter(([, q]) => q > 0)
      .map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
    const parsed = returnRequestSchema.safeParse({
      orderId: order.id,
      reason,
      comments: comments.trim() || undefined,
      items,
    });
    if (!parsed.success) {
      setError(
        items.length === 0
          ? 'Select at least one item to return.'
          : (parsed.error.issues[0]?.message ?? 'Please check the form'),
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api<ReturnRequestDto>('/returns', { method: 'POST', body: parsed.data });
      toast.success('Return requested. We’ll email you the pickup details.');
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
      title="Request a return"
      description="Select the items and quantities you’d like to return."
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            Submit return
          </Button>
        </div>
      }
    >
      <div className="space-y-5 p-5">
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Items
          </legend>
          <ul className="divide-y divide-border rounded-md border border-border">
            {returnable.map((i) => {
              const max = i.quantity - i.returnedQuantity;
              const value = qty[i.id] ?? 0;
              return (
                <li key={i.id} className="flex items-center gap-3 p-3">
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
                      label={`Return quantity for ${i.name}`}
                    />
                  )}
                </li>
              );
            })}
          </ul>
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
                Return items
              </Button>
            )}
          </div>
        )}
      </div>
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
              <ul className="space-y-2 text-sm">
                {order.returns.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>{r.items.map((i) => `${i.name} ×${i.quantity}`).join(', ')}</span>
                    <Badge
                      tone={
                        r.status === 'REJECTED'
                          ? 'danger'
                          : r.status === 'REFUNDED'
                            ? 'success'
                            : 'info'
                      }
                    >
                      {RETURN_STATUS_LABEL[r.status]}
                    </Badge>
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
