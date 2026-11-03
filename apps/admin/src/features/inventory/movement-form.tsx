'use client';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { InventoryRowDto } from '@vyra/shared';
import { inventoryMovementSchema } from '@vyra/shared';
import { Alert, Button, Field, Input } from '@vyra/ui';
import { Minus, Plus } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { applyApiErrors, blankToNull, parseOrSetErrors } from '@/lib/forms';
import { useApi } from '@/lib/swr';
import type { SupplierDto } from '@vyra/shared';
import { Segmented, Select } from '@/components/ui/controls';
import { formatNumber } from '@/lib/format';

export type ManualMovementType = 'STOCK_IN' | 'STOCK_OUT' | 'ADJUSTMENT';

interface Values { type: ManualMovementType; quantity: string; direction: 'up' | 'down'; reason: string; reference: string; supplierId: string; unitCost: string }

const TYPE_LABEL: Record<ManualMovementType, string> = { STOCK_IN: 'Stock in', STOCK_OUT: 'Stock out', ADJUSTMENT: 'Adjustment' };
const REASONS: Record<ManualMovementType, string[]> = {
  STOCK_IN: ['Goods received from supplier', 'Customer return restock', 'Transfer in'],
  STOCK_OUT: ['Damaged', 'Sample / photoshoot', 'Transfer out', 'Lost'],
  ADJUSTMENT: ['Cycle count correction', 'Stock audit', 'Data entry correction'],
};

/**
 * Explicit stock movement form. Every change requires quantity + reason; nothing
 * is written until the staff member confirms. `scanId` links the movement to a scan.
 */
export function MovementForm({
  variant, types = ['STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT'], defaultType = 'STOCK_IN', defaultReason = '', defaultReference = '', defaultQuantity = 1,
  scanId, onDone, onCancel, submitLabel, compact,
}: {
  variant: Pick<InventoryRowDto, 'variantId' | 'sku' | 'onHand' | 'reserved' | 'available'> & { productName?: string };
  types?: ManualMovementType[]; defaultType?: ManualMovementType; defaultReason?: string; defaultReference?: string; defaultQuantity?: number;
  scanId?: string; onDone: (row: InventoryRowDto) => void; onCancel?: () => void; submitLabel?: string; compact?: boolean;
}) {
  const { data: suppliers } = useApi<SupplierDto[]>('/suppliers', { pageSize: 100 });
  const { register, handleSubmit, setError, watch, setValue, formState: { errors, isSubmitting } } = useForm<Values>({
    defaultValues: { type: defaultType, quantity: String(defaultQuantity), direction: 'up', reason: defaultReason, reference: defaultReference, supplierId: '', unitCost: '' },
  });
  React.useEffect(() => { setValue('quantity', String(defaultQuantity)); }, [defaultQuantity, setValue]);
  const type = watch('type');
  const direction = watch('direction');
  const qty = Number(watch('quantity')) || 0;
  const delta = type === 'STOCK_IN' ? qty : type === 'STOCK_OUT' ? -qty : direction === 'up' ? qty : -qty;
  const after = variant.onHand + delta;

  const onSubmit = handleSubmit(async (v) => {
    const n = Math.abs(Math.trunc(Number(v.quantity)));
    if (!n) { setError('quantity', { message: 'Enter a quantity greater than zero' }); return; }
    const signed = v.type === 'ADJUSTMENT' && v.direction === 'down' ? -n : n;
    if (v.type !== 'STOCK_IN' && variant.onHand + (v.type === 'STOCK_OUT' ? -n : signed) < 0) {
      setError('quantity', { message: `Only ${variant.onHand} on hand` });
      return;
    }
    const body = blankToNull({
      variantId: variant.variantId, type: v.type, quantity: signed, reason: v.reason, reference: v.reference,
      supplierId: v.type === 'STOCK_IN' ? v.supplierId : '', unitCost: v.type === 'STOCK_IN' ? v.unitCost : '', scanId: scanId ?? '',
    });
    const parsed = parseOrSetErrors(inventoryMovementSchema, body, setError);
    if (!parsed) return;
    try {
      const row = await api.post<InventoryRowDto>('/inventory/movements', parsed);
      toast.success(`${TYPE_LABEL[v.type]} recorded · ${variant.sku} now ${formatNumber(row.onHand)} on hand`);
      onDone(row);
    } catch (err) {
      if (!applyApiErrors(err, setError)) setError('root.server', { message: errorMessage(err) });
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {errors.root?.server && <Alert tone="danger">{errors.root.server.message}</Alert>}
      {types.length > 1 && (
        <Segmented label="Movement type" value={type} onChange={(t) => setValue('type', t)} options={types.map((t) => ({ value: t, label: TYPE_LABEL[t] }))} />
      )}
      <div className={compact ? 'grid gap-3 sm:grid-cols-2' : 'grid gap-4 sm:grid-cols-2'}>
        <Field label={type === 'ADJUSTMENT' ? 'Quantity change' : 'Quantity'} htmlFor="mv-qty" error={errors.quantity?.message}>
          <div className="flex items-center gap-2">
            {type === 'ADJUSTMENT' && (
              <Segmented label="Direction" value={direction} onChange={(d) => setValue('direction', d)} options={[{ value: 'up', label: <Plus className="size-4" aria-label="Increase" /> }, { value: 'down', label: <Minus className="size-4" aria-label="Decrease" /> }]} />
            )}
            <Input id="mv-qty" type="number" inputMode="numeric" min={1} step={1} className="tabular" invalid={!!errors.quantity} {...register('quantity')} />
          </div>
        </Field>
        <div className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
          <p className="text-xs text-muted">On hand after</p>
          <p className="tabular mt-0.5 font-semibold">
            {formatNumber(variant.onHand)} <span className={delta >= 0 ? 'text-success' : 'text-danger'}>{delta >= 0 ? '+' : '−'}{formatNumber(Math.abs(delta))}</span> = {formatNumber(after)}
          </p>
          {after < variant.reserved && <p className="mt-0.5 text-xs text-warning">Below reserved quantity ({variant.reserved})</p>}
        </div>
        <Field label="Reason (required)" htmlFor="mv-reason" error={errors.reason?.message} className="sm:col-span-2">
          <Input id="mv-reason" invalid={!!errors.reason} placeholder="Why is stock changing?" {...register('reason')} />
          <div className="mt-1.5 flex flex-wrap gap-1">
            {REASONS[type].map((r) => <button key={r} type="button" onClick={() => setValue('reason', r, { shouldValidate: false })} className="rounded-full border border-border px-2 py-0.5 text-xs text-muted hover:border-border-strong hover:text-fg">{r}</button>)}
          </div>
        </Field>
        <Field label="Reference" htmlFor="mv-ref" error={errors.reference?.message} hint="Invoice, PO, order or return number"><Input id="mv-ref" {...register('reference')} /></Field>
        {type === 'STOCK_IN' && (
          <>
            <Field label="Supplier" htmlFor="mv-sup" error={errors.supplierId?.message}>
              <Select id="mv-sup" {...register('supplierId')}>
                <option value="">None</option>
                {(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Unit cost ₹" htmlFor="mv-cost" error={errors.unitCost?.message}><Input id="mv-cost" type="number" inputMode="decimal" step="0.01" min={0} className="tabular" {...register('unitCost')} /></Field>
          </>
        )}
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" size={compact ? 'lg' : 'sm'} variant="secondary" loading={isSubmitting} className={compact ? 'w-full sm:w-auto' : undefined}>{submitLabel ?? `Confirm ${TYPE_LABEL[type].toLowerCase()}`}</Button>
      </div>
    </form>
  );
}
