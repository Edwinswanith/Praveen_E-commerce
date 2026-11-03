'use client';
import * as React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import type { OrderStatus } from '@vyra/shared';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton, cn } from '@vyra/ui';
import { ArrowLeft, FileText, IndianRupee, ScanLine, Truck, ExternalLink, PhoneCall, Repeat } from 'lucide-react';
import { useApi } from '@/lib/swr';
import { api, errorMessage } from '@/lib/api';
import { openFile } from '@/lib/download';
import { useAuth } from '@/features/auth/auth-context';
import { PERM } from '@/lib/permissions';
import type { AdminOrderDetail } from '@/lib/types';
import { formatDateTime, formatINR, formatNumber, humanize } from '@/lib/format';
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE, PAYMENT_STATUS_TONE, REFUND_STATUS_TONE, RETURN_STATUS_TONE, RETURN_TYPE_LABEL, RETURN_TYPE_TONE, SHIPMENT_STATUS_TONE } from '@/lib/status';
import { ErrorState, KeyValue, PageHeader, StatusBadge } from '@/components/ui/feedback';
import { useConfirm } from '@/components/ui/confirm';
import { dispatchProgress } from '@/features/scanner/dispatch-panel';
import { NextStatusActions, ACTION_LABEL } from './next-status';
import { CancelOrderDialog, ConfirmCodDialog, RefundDialog, RtoDialog, ShipmentDialog } from './order-dialogs';
import { exchangeLabel } from '@/features/returns/exchange';

export const COD_PENDING_PACK_REASON = 'Packing is locked until this Cash on Delivery order is confirmed (customer OTP or a staff call).';

const back = <Link href="/orders" className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-fg"><ArrowLeft className="size-3.5" /> Orders</Link>;

export function OrderDetail({ id }: { id: string }) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const { data: o, error, isLoading, mutate } = useApi<AdminOrderDetail>(`/orders/${id}`);
  const [dialog, setDialog] = React.useState<'cancel' | 'ship' | 'refund' | 'cod' | 'rto' | null>(null);
  const [pendingStatus, setPendingStatus] = React.useState<OrderStatus | null>(null);
  const [invoicePending, setInvoicePending] = React.useState(false);

  if (error && !o) return <>{back}<ErrorState error={error} onRetry={() => void mutate()} /></>;
  if (isLoading || !o) return <div className="space-y-4"><Skeleton className="h-8 w-72" /><div className="grid gap-5 lg:grid-cols-3"><Skeleton className="h-96 lg:col-span-2" /><Skeleton className="h-96" /></div></div>;

  const progress = dispatchProgress(o.dispatch ?? []);
  const captured = o.payments.filter((p) => ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(p.status)).reduce((s, p) => s + p.amount, 0);
  const refunded = o.refunds.filter((r) => r.status !== 'FAILED').reduce((s, r) => s + r.amount, 0);
  const refundable = Math.max(0, Math.round((captured - refunded) * 100) / 100);
  const canWrite = can(PERM.ordersWrite);
  const codPending = o.codConfirmation === 'PENDING' && o.status !== 'CANCELLED';
  const blocked = codPending ? { PACKED: COD_PENDING_PACK_REASON } : undefined;
  const contactPhone = o.customer?.phone ?? o.shippingAddress.phone;

  const changeStatus = async (next: OrderStatus) => {
    let description: string | undefined;
    if (next === 'PACKED' && !progress.complete) description = `Only ${progress.scanned} of ${progress.total} units have been verified by scanning. Pack anyway?`;
    if (next === 'SHIPPED' && !o.shipment) description = 'No shipment has been created yet. Consider creating one first so the customer gets tracking details.';
    const ok = await confirm({ title: `${ACTION_LABEL[next]}?`, description: description ?? `Order ${o.number} will move to “${ORDER_STATUS_LABEL[next]}”. The customer may be notified.`, confirmLabel: ACTION_LABEL[next] });
    if (!ok) return;
    setPendingStatus(next);
    try {
      await api.post(`/orders/${o.id}/status`, { status: next });
      toast.success(`Order ${ORDER_STATUS_LABEL[next].toLowerCase()}`);
      void mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPendingStatus(null);
    }
  };

  const invoice = async () => {
    setInvoicePending(true);
    try { await openFile(`/orders/${o.id}/invoice`, `invoice-${o.number}.pdf`); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setInvoicePending(false); }
  };

  const done = () => { setDialog(null); void mutate(); };
  const a = o.shippingAddress;

  return (
    <>
      <PageHeader
        back={back}
        title={`Order ${o.number}`}
        description={<span className="flex flex-wrap items-center gap-2"><StatusBadge value={o.status} tone={ORDER_STATUS_TONE[o.status]} label={ORDER_STATUS_LABEL[o.status]} /><span>Placed {formatDateTime(o.createdAt)}</span><span>· {o.paymentMethod}</span></span>}
        actions={<>
          <Button variant="outline" size="sm" loading={invoicePending} onClick={() => void invoice()}><FileText /> Invoice</Button>
          {canWrite && !o.shipment && !codPending && ['CONFIRMED', 'PACKED'].includes(o.status) && <Button variant="outline" size="sm" onClick={() => setDialog('ship')}><Truck /> Create shipment</Button>}
          {canWrite && codPending && <Button variant="secondary" size="sm" onClick={() => setDialog('cod')}><PhoneCall /> Mark confirmed (called customer)</Button>}
          {can(PERM.ordersRefund) && refundable > 0 && <Button variant="outline" size="sm" onClick={() => setDialog('refund')}><IndianRupee /> Refund</Button>}
        </>}
      />

      {o.exchangeForOrderNumber && (
        <Alert tone="info" className="mb-5"><span className="inline-flex items-center gap-1.5"><Repeat className="size-4" /> Replacement for order <Link href={`/orders/${o.exchangeForOrderNumber}`} className="font-semibold underline">{o.exchangeForOrderNumber}</Link> (exchange). No payment is due.</span></Alert>
      )}
      {codPending && (
        <Alert tone="warning" className="mb-5" title="Awaiting COD confirmation">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>The customer hasn&apos;t confirmed this Cash on Delivery order by OTP yet. Call {contactPhone ? <span className="font-mono font-semibold">{contactPhone}</span> : 'the customer'} before packing. Unconfirmed COD orders are cancelled automatically.</span>
            {canWrite && <Button size="sm" variant="secondary" onClick={() => setDialog('cod')}><PhoneCall /> Mark confirmed (called customer)</Button>}
          </div>
        </Alert>
      )}
      {o.status === 'RTO' && o.paymentMethod !== 'COD' && refundable > 0 && (
        <Alert tone="danger" className="mb-5" title="Prepaid parcel returned to origin">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>The customer paid {formatINR(captured)} online but never received the parcel. Issue a refund of up to {formatINR(refundable)}.</span>
            {can(PERM.ordersRefund) && <Button size="sm" variant="danger" onClick={() => setDialog('refund')}><IndianRupee /> Issue refund</Button>}
          </div>
        </Alert>
      )}

      <Card className="mb-5">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold">Next step</p>
            <p className="text-xs text-muted">Only transitions allowed from “{ORDER_STATUS_LABEL[o.status]}” are shown.</p>
          </div>
          <NextStatusActions status={o.status} canWrite={canWrite} onSelect={(s) => void changeStatus(s)} onCancel={() => setDialog('cancel')} onRto={() => setDialog('rto')} blocked={blocked} pendingStatus={pendingStatus} disabled={!!pendingStatus} />
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <Card className="overflow-hidden">
            <CardHeader><CardTitle>Items</CardTitle><span className="text-xs text-muted">{formatNumber(o.itemCount)} units</span></CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface text-xs text-muted"><tr><th className="px-4 py-2 text-left font-medium">Item</th><th className="px-3 py-2 text-right font-medium">Price</th><th className="px-3 py-2 text-right font-medium">Qty</th><th className="px-3 py-2 text-right font-medium">GST</th><th className="px-4 py-2 text-right font-medium">Total</th></tr></thead>
                <tbody>
                  {o.items.map((i) => (
                    <tr key={i.id} className="border-t border-border">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-3">
                          <span className="size-12 shrink-0 overflow-hidden rounded-md bg-surface-2">{i.imageUrl && <img src={i.imageUrl} alt="" className="size-full object-cover" />}</span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{i.name}</span>
                            <span className="block font-mono text-xs text-muted">{i.sku} · {i.color}/{i.size}</span>
                            {i.returnedQuantity > 0 && <Badge tone="warning" className="mt-0.5">{i.returnedQuantity} returned</Badge>}
                          </span>
                        </div>
                      </td>
                      <td className="tabular px-3 py-2.5 text-right">{formatINR(i.unitPrice)}{i.unitMrp > i.unitPrice && <span className="block text-xs text-muted line-through">{formatINR(i.unitMrp)}</span>}</td>
                      <td className="tabular px-3 py-2.5 text-right">{formatNumber(i.quantity)}</td>
                      <td className="tabular px-3 py-2.5 text-right text-xs text-muted">{i.taxRate}%<span className="block">{formatINR(i.taxAmount)}</span></td>
                      <td className="tabular px-4 py-2.5 text-right font-medium">{formatINR(i.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {o.dispatch && o.dispatch.length > 0 && ['CONFIRMED', 'PACKED'].includes(o.status) && (
            <Card>
              <CardHeader>
                <CardTitle>Dispatch verification</CardTitle>
                <Button asChild variant="ghost" size="sm"><Link href="/scanner"><ScanLine /> Open scanner</Link></Button>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-baseline justify-between text-sm"><span>{progress.complete ? 'All items verified' : 'Scan each item before packing'}</span><span className="tabular font-semibold">{progress.scanned}/{progress.total}</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.scanned} aria-label="Dispatch verification">
                  <div className={cn('h-full rounded-full', progress.complete ? 'bg-success' : 'bg-violet-500')} style={{ width: `${progress.total ? (progress.scanned / progress.total) * 100 : 0}%` }} />
                </div>
                <ul className="grid gap-1 text-xs sm:grid-cols-2">
                  {o.dispatch.map((d) => (
                    <li key={d.variantId} className={cn('flex justify-between rounded-sm px-2 py-1', d.scanned > d.expected ? 'bg-red-50 text-danger' : d.scanned === d.expected ? 'bg-emerald-50 text-emerald-700' : 'bg-surface')}>
                      <span className="font-mono">{d.sku}</span><span className="tabular font-semibold">{d.scanned}/{d.expected}</span>
                    </li>
                  ))}
                </ul>
                {progress.over.length > 0 && <Alert tone="danger">Over-scanned: {progress.over.map((x) => x.sku).join(', ')}</Alert>}
              </CardContent>
            </Card>
          )}

          {o.shipment && (
            <Card>
              <CardHeader><CardTitle>Shipment</CardTitle><StatusBadge value={o.shipment.status} tone={SHIPMENT_STATUS_TONE[o.shipment.status]} /></CardHeader>
              <CardContent className="space-y-4">
                <KeyValue items={[
                  { label: 'Provider', value: humanize(o.shipment.provider) },
                  { label: 'Courier', value: o.shipment.courierName ?? '—' },
                  { label: 'AWB', value: <span className="font-mono">{o.shipment.trackingNumber ?? '—'}</span> },
                  { label: 'Tracking', value: o.shipment.trackingUrl ? <a href={o.shipment.trackingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline">Open <ExternalLink className="size-3" /></a> : '—' },
                  { label: 'Shipped', value: formatDateTime(o.shipment.shippedAt) },
                  { label: 'Delivered', value: formatDateTime(o.shipment.deliveredAt) },
                  ...(o.shipment.labelUrl ? [{ label: 'Label', value: <a href={o.shipment.labelUrl} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">Download label</a> }] : []),
                ]} />
                {o.shipment.events.length > 0 && (
                  <ol className="space-y-2 border-t border-border pt-3 text-sm">
                    {o.shipment.events.map((e, i) => <li key={i} className="flex justify-between gap-3"><span>{e.description ?? humanize(e.status)}{e.location ? <span className="text-muted"> · {e.location}</span> : null}</span><span className="shrink-0 text-xs text-muted">{formatDateTime(e.occurredAt)}</span></li>)}
                  </ol>
                )}
              </CardContent>
            </Card>
          )}

          {o.returns.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Returns</CardTitle><Link href="/returns" className="text-xs font-semibold text-muted hover:text-fg">Manage returns</Link></CardHeader>
              <ul className="divide-y divide-border">
                {o.returns.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span>
                      <span className="flex items-center gap-2 font-medium"><Badge tone={RETURN_TYPE_TONE[r.type]}>{RETURN_TYPE_LABEL[r.type]}</Badge>{humanize(r.reason)}</span>
                      <span className="block text-xs text-muted">{r.items.map((i) => `${i.quantity}× ${i.sku}${i.exchangeFor ? ` → ${exchangeLabel(i)}` : ''}`).join(', ')}</span>
                      {r.replacementOrderNumber && <span className="block text-xs">Replacement order <Link href={`/orders/${r.replacementOrderNumber}`} className="font-semibold text-brand-600 hover:underline">{r.replacementOrderNumber}</Link></span>}
                    </span>
                    <span className="text-right"><StatusBadge value={r.status} tone={RETURN_STATUS_TONE[r.status]} /><span className="tabular block text-xs text-muted">{r.type === 'EXCHANGE' ? 'Exchange' : formatINR(r.refundAmount)}</span></span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Timeline</CardTitle></CardHeader>
            <CardContent>
              <ol className="relative space-y-4 border-l border-border pl-5">
                {[...o.events].sort((x, y) => y.createdAt.localeCompare(x.createdAt)).map((e, i) => (
                  <li key={i} className="relative">
                    <span className={cn('absolute -left-[25px] top-1 size-2.5 rounded-full ring-4 ring-bg', i === 0 ? 'bg-fg' : 'bg-border-strong')} aria-hidden />
                    <p className="text-sm font-medium">{ORDER_STATUS_LABEL[e.status] ?? humanize(e.status)}</p>
                    {e.note && <p className="text-sm text-muted">{e.note}</p>}
                    <p className="text-xs text-subtle">{formatDateTime(e.createdAt)}{e.actor ? ` · ${e.actor}` : ''}</p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader><CardTitle>Customer</CardTitle>{o.customer && can(PERM.customersRead) && <Link href={`/customers/${o.customer.id}`} className="text-xs font-semibold text-muted hover:text-fg">Profile</Link>}</CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-medium">{o.customer?.name ?? o.customerName}</p>
              {(o.customer?.email ?? o.customerEmail) && <p className="text-muted">{o.customer?.email ?? o.customerEmail}</p>}
              {o.customer?.phone && <p className="text-muted">{o.customer.phone}</p>}
              {!o.customer && <Badge tone="neutral">Guest checkout</Badge>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Shipping address</CardTitle><span className="text-xs text-muted">{o.shippingMethod === 'EXPRESS' ? 'Express' : 'Standard'}</span></CardHeader>
            <CardContent className="text-sm leading-relaxed">
              <p className="font-medium">{a.fullName}</p>
              <p>{a.line1}</p>{a.line2 && <p>{a.line2}</p>}{a.landmark && <p className="text-muted">Near {a.landmark}</p>}
              <p>{a.city}, {a.state} {a.pincode}</p>
              <p className="mt-1 text-muted">{a.phone}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
            <CardContent>
              <dl className="tabular space-y-1.5 text-sm">
                <Row label="MRP total" value={formatINR(o.mrpTotal)} />
                <Row label="Subtotal" value={formatINR(o.subtotal)} />
                {o.promotionDiscount > 0 && <Row label="Bundle offer" value={`− ${formatINR(o.promotionDiscount)}`} />}
                {o.prepaidDiscount > 0 && <Row label="Prepaid discount" value={`− ${formatINR(o.prepaidDiscount)}`} />}
                {o.couponDiscount > 0 && <Row label={`Coupon${o.couponCode ? ` (${o.couponCode})` : ''}`} value={`− ${formatINR(o.couponDiscount)}`} />}
                <Row label="Shipping" value={o.shippingFee ? formatINR(o.shippingFee) : 'Free'} />
                {o.codFee > 0 && <Row label="COD fee" value={formatINR(o.codFee)} />}
                <Row label="GST (incl.)" value={formatINR(o.taxTotal)} muted />
                <div className="flex justify-between border-t border-border pt-2 text-base font-semibold"><dt>Total</dt><dd>{formatINR(o.grandTotal)}</dd></div>
                {refunded > 0 && <Row label="Refunded" value={`− ${formatINR(refunded)}`} />}
              </dl>
              <SavingsBreakdown savings={o.savings} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Payments</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {o.payments.length === 0 && <p className="text-muted">No payment records{o.paymentMethod === 'COD' ? ' (cash on delivery)' : ''}.</p>}
              {o.payments.map((p) => (
                <div key={p.id} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between"><span className="font-medium">{humanize(p.provider)} · {p.method}</span><Badge tone={PAYMENT_STATUS_TONE[p.status]}>{humanize(p.status)}</Badge></div>
                  <p className="tabular mt-1 font-semibold">{formatINR(p.amount)}</p>
                  <p className="mt-0.5 break-all font-mono text-[11px] text-muted">{p.providerPaymentId ?? p.providerOrderId ?? p.id}</p>
                  <p className="text-xs text-subtle">{formatDateTime(p.createdAt)}</p>
                </div>
              ))}
              {o.refunds.length > 0 && <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted">Refunds</p>}
              {o.refunds.map((r) => (
                <div key={r.id} className="flex items-start justify-between gap-2 rounded-md bg-surface p-2.5">
                  <span><span className="tabular font-medium">{formatINR(r.amount)}</span><span className="block text-xs text-muted">{r.reason ?? '—'} · {formatDateTime(r.createdAt)}</span></span>
                  <Badge tone={REFUND_STATUS_TONE[r.status]}>{humanize(r.status)}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {dialog === 'cancel' && <CancelOrderDialog orderId={o.id} number={o.number} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'ship' && <ShipmentDialog orderId={o.id} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'cod' && <ConfirmCodDialog orderId={o.id} number={o.number} phone={contactPhone} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'rto' && <RtoDialog orderId={o.id} number={o.number} paymentMethod={o.paymentMethod} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'refund' && <RefundDialog orderId={o.id} maxAmount={refundable} onClose={() => setDialog(null)} onDone={done} />}
    </>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return <div className={cn('flex justify-between', muted && 'text-muted')}><dt className="text-muted">{label}</dt><dd>{value}</dd></div>;
}

/** Where the customer's discount came from (order discount ledger). Hidden when there were no savings. */
export function SavingsBreakdown({ savings }: { savings: AdminOrderDetail['savings'] | undefined }) {
  if (!savings) return null;
  const parts = [
    { label: 'Sale price', value: savings.campaign },
    { label: 'Bundle offer', value: savings.promotion },
    { label: 'Coupon', value: savings.coupon },
    { label: 'Prepaid', value: savings.prepaid },
  ];
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total <= 0) return null;
  return (
    <div className="mt-4 rounded-md bg-emerald-50 p-3 text-sm" aria-label="Customer savings">
      <p className="flex justify-between font-semibold text-emerald-800"><span>Customer saved</span><span className="tabular">{formatINR(total)}</span></p>
      <dl className="tabular mt-1.5 space-y-1 text-xs">
        {parts.filter((p) => p.value > 0).map((p) => (
          <div key={p.label} className="flex justify-between text-emerald-900/80"><dt>{p.label}</dt><dd>{formatINR(p.value)}</dd></div>
        ))}
      </dl>
    </div>
  );
}
