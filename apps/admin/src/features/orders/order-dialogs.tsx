'use client';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { cancelOrderSchema, shipmentCreateSchema } from '@vyra/shared';
import { Alert, Button, Field, Input, Textarea } from '@vyra/ui';
import { z } from 'zod';
import { api, errorMessage } from '@/lib/api';
import { applyApiErrors, blankToNull, parseOrSetErrors } from '@/lib/forms';
import { formatINR } from '@/lib/format';
import { Dialog } from '@/components/ui/dialog';
import { Segmented } from '@/components/ui/controls';

export function CancelOrderDialog({ orderId, number, onClose, onDone }: { orderId: string; number: string; onClose: () => void; onDone: () => void }) {
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<{ reason: string }>({ defaultValues: { reason: '' } });
  const submit = handleSubmit(async (v) => {
    const parsed = parseOrSetErrors(cancelOrderSchema, v, setError);
    if (!parsed) return;
    try {
      await api.post(`/orders/${orderId}/cancel`, parsed);
      toast.success(`Order ${number} cancelled`);
      onDone();
    } catch (err) {
      if (!applyApiErrors(err, setError)) setError('root.server', { message: errorMessage(err) });
    }
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Cancel order ${number}?`} description="Reserved stock is released and any captured payment is refunded to the customer."
      footer={<><Button variant="ghost" size="sm" onClick={onClose}>Keep order</Button><Button variant="danger" size="sm" loading={isSubmitting} onClick={() => void submit()}>Cancel order</Button></>}>
      <form onSubmit={submit} noValidate className="space-y-3">
        {errors.root?.server && <Alert tone="danger">{errors.root.server.message}</Alert>}
        <Field label="Reason (shared with the customer)" htmlFor="cancel-reason" error={errors.reason?.message}>
          <Textarea id="cancel-reason" rows={3} autoFocus invalid={!!errors.reason} {...register('reason')} />
        </Field>
      </form>
    </Dialog>
  );
}

interface ShipValues { courierName: string; trackingNumber: string; trackingUrl: string }

export function ShipmentDialog({ orderId, onClose, onDone }: { orderId: string; onClose: () => void; onDone: () => void }) {
  const [provider, setProvider] = React.useState<'MANUAL' | 'SHIPROCKET'>('MANUAL');
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<ShipValues>({ defaultValues: { courierName: '', trackingNumber: '', trackingUrl: '' } });
  const submit = handleSubmit(async (v) => {
    if (provider === 'MANUAL') {
      if (!v.courierName.trim()) { setError('courierName', { message: 'Courier is required for manual shipments' }); return; }
      if (!v.trackingNumber.trim()) { setError('trackingNumber', { message: 'AWB / tracking number is required' }); return; }
    }
    const raw = provider === 'MANUAL' ? { provider, ...v } : { provider };
    const cleaned = Object.fromEntries(Object.entries(blankToNull(raw)).filter(([, x]) => x !== null));
    const parsed = parseOrSetErrors(shipmentCreateSchema, cleaned, setError);
    if (!parsed) return;
    try {
      await api.post(`/orders/${orderId}/shipment`, parsed);
      toast.success(provider === 'SHIPROCKET' ? 'Shipment created with Shiprocket' : 'Shipment recorded');
      onDone();
    } catch (err) {
      if (!applyApiErrors(err, setError)) setError('root.server', { message: errorMessage(err) });
    }
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Create shipment"
      footer={<><Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" loading={isSubmitting} onClick={() => void submit()}>Create shipment</Button></>}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {errors.root?.server && <Alert tone="danger">{errors.root.server.message}</Alert>}
        <Segmented label="Shipping provider" value={provider} onChange={setProvider} options={[{ value: 'MANUAL', label: 'Manual (own courier)' }, { value: 'SHIPROCKET', label: 'Shiprocket' }]} />
        {provider === 'MANUAL' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Courier" htmlFor="sh-courier" error={errors.courierName?.message}><Input id="sh-courier" placeholder="Delhivery, Blue Dart…" invalid={!!errors.courierName} {...register('courierName')} /></Field>
            <Field label="AWB / tracking number" htmlFor="sh-awb" error={errors.trackingNumber?.message}><Input id="sh-awb" className="font-mono" invalid={!!errors.trackingNumber} {...register('trackingNumber')} /></Field>
            <Field label="Tracking URL (optional)" htmlFor="sh-url" error={errors.trackingUrl?.message} className="sm:col-span-2"><Input id="sh-url" type="url" placeholder="https://…" invalid={!!errors.trackingUrl} {...register('trackingUrl')} /></Field>
          </div>
        ) : (
          <Alert tone="info">The API books the shipment with Shiprocket, assigns a courier and AWB, and stores the label. Requires Shiprocket credentials on the server.</Alert>
        )}
      </form>
    </Dialog>
  );
}

export function RefundDialog({ orderId, maxAmount, onClose, onDone }: { orderId: string; maxAmount: number; onClose: () => void; onDone: () => void }) {
  const schema = React.useMemo(() => z.object({
    amount: z.coerce.number().positive('Enter an amount').max(maxAmount, `Cannot exceed ${formatINR(maxAmount)}`).multipleOf(0.01, 'Max 2 decimals'),
    reason: z.string().trim().min(3, 'Give a reason').max(300),
  }), [maxAmount]);
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<{ amount: string; reason: string }>({ defaultValues: { amount: String(maxAmount), reason: '' } });
  const submit = handleSubmit(async (v) => {
    const parsed = parseOrSetErrors(schema, v, setError);
    if (!parsed) return;
    try {
      await api.post(`/orders/${orderId}/refunds`, parsed);
      toast.success(`Refund of ${formatINR(parsed.amount)} initiated`);
      onDone();
    } catch (err) {
      if (!applyApiErrors(err, setError)) setError('root.server', { message: errorMessage(err) });
    }
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Issue refund" description={`Refundable balance: ${formatINR(maxAmount)}. Refunds go back to the original payment method.`}
      footer={<><Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button><Button variant="danger" size="sm" loading={isSubmitting} onClick={() => void submit()}>Refund</Button></>}>
      <form onSubmit={submit} noValidate className="grid gap-4">
        {errors.root?.server && <Alert tone="danger">{errors.root.server.message}</Alert>}
        <Field label="Amount ₹" htmlFor="rf-amount" error={errors.amount?.message}><Input id="rf-amount" type="number" inputMode="decimal" step="0.01" min={0.01} max={maxAmount} className="tabular" invalid={!!errors.amount} {...register('amount')} /></Field>
        <Field label="Reason" htmlFor="rf-reason" error={errors.reason?.message}><Textarea id="rf-reason" rows={2} invalid={!!errors.reason} {...register('reason')} /></Field>
      </form>
    </Dialog>
  );
}
