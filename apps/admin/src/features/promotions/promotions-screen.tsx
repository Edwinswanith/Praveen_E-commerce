'use client';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import type { CategoryNode, CouponDto } from '@vyra/shared';
import { couponSchema } from '@vyra/shared';
import { Alert, Badge, Button, Field, Input, Textarea } from '@vyra/ui';
import { Pencil, Plus, TicketPercent, Trash2 } from 'lucide-react';
import { useApi } from '@/lib/swr';
import { api, errorMessage } from '@/lib/api';
import { applyApiErrors, blankToNull, parseOrSetErrors } from '@/lib/forms';
import { useAuth } from '@/features/auth/auth-context';
import { PERM } from '@/lib/permissions';
import { formatDate, formatINR, formatNumber } from '@/lib/format';
import { DataTable } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import { PageHeader } from '@/components/ui/feedback';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Segmented, Switch } from '@/components/ui/controls';
import { useConfirm } from '@/components/ui/confirm';
import { flattenTree } from '@/features/categories/tree';

function couponState(c: CouponDto): { label: string; tone: 'success' | 'neutral' | 'warning' | 'info' } {
  const now = Date.now();
  if (!c.isActive) return { label: 'Inactive', tone: 'neutral' };
  if (c.expiresAt && new Date(c.expiresAt).getTime() < now) return { label: 'Expired', tone: 'warning' };
  if (c.startsAt && new Date(c.startsAt).getTime() > now) return { label: 'Scheduled', tone: 'info' };
  if (c.usageLimit !== null && c.usedCount >= c.usageLimit) return { label: 'Used up', tone: 'warning' };
  return { label: 'Live', tone: 'success' };
}

export function PromotionsScreen() {
  const { can } = useAuth();
  const canWrite = can(PERM.promotionsWrite);
  const confirm = useConfirm();
  const [page, setPage] = React.useState(1);
  const { data, meta, error, isLoading, mutate } = useApi<CouponDto[]>('/coupons', { page, pageSize: 25 });
  const { data: categories } = useApi<CategoryNode[]>(can(PERM.catalogRead) ? '/categories' : null);
  const [editing, setEditing] = React.useState<CouponDto | 'new' | null>(null);

  const remove = React.useCallback(async (c: CouponDto) => {
    if (!(await confirm({ title: `Delete coupon ${c.code}?`, description: c.usedCount ? 'This coupon has been used. Consider deactivating it instead to keep reporting intact.' : undefined, confirmLabel: 'Delete', destructive: true }))) return;
    try { await api.delete(`/coupons/${c.id}`); toast.success('Coupon deleted'); void mutate(); }
    catch (err) { toast.error(errorMessage(err)); }
  }, [confirm, mutate]);

  const columns = React.useMemo<ColumnDef<CouponDto, unknown>[]>(() => [
    { header: 'Code', accessorKey: 'code', cell: ({ row }) => <span className="block"><span className="font-mono font-semibold">{row.original.code}</span>{row.original.description && <span className="block max-w-64 truncate text-xs text-muted">{row.original.description}</span>}</span> },
    { header: 'Discount', id: 'value', cell: ({ row: { original: c } }) => <span className="tabular whitespace-nowrap">{c.type === 'PERCENTAGE' ? `${c.value}%` : formatINR(c.value)}{c.maxDiscount ? <span className="text-xs text-muted"> · max {formatINR(c.maxDiscount)}</span> : null}</span> },
    { header: 'Min order', accessorKey: 'minOrderValue', meta: { align: 'right' }, cell: ({ row }) => (row.original.minOrderValue ? formatINR(row.original.minOrderValue) : '—') },
    { header: 'Validity', id: 'dates', cell: ({ row: { original: c } }) => <span className="whitespace-nowrap text-xs text-muted">{c.startsAt ? formatDate(c.startsAt) : 'Now'} → {c.expiresAt ? formatDate(c.expiresAt) : 'No end'}</span> },
    { header: 'Used', id: 'used', meta: { align: 'right' }, cell: ({ row: { original: c } }) => <span className="tabular">{formatNumber(c.usedCount)}{c.usageLimit ? ` / ${formatNumber(c.usageLimit)}` : ''}</span> },
    { header: 'Scope', id: 'scope', cell: ({ row }) => <span className="text-xs text-muted">{row.original.categoryIds.length ? `${row.original.categoryIds.length} categor${row.original.categoryIds.length === 1 ? 'y' : 'ies'}` : 'All products'}</span> },
    { header: 'Status', id: 'status', cell: ({ row }) => { const s = couponState(row.original); return <Badge tone={s.tone}>{s.label}</Badge>; } },
    ...(canWrite ? [{
      id: 'actions', header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }: { row: { original: CouponDto } }) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" onClick={() => setEditing(row.original)} aria-label={`Edit ${row.original.code}`}><Pencil /></Button>
          <Button variant="ghost" size="sm" onClick={() => void remove(row.original)} aria-label={`Delete ${row.original.code}`}><Trash2 /></Button>
        </div>
      ),
    } satisfies ColumnDef<CouponDto, unknown>] : []),
  ], [canWrite, remove]);

  return (
    <>
      <PageHeader title="Promotions" description="Coupon codes for percentage or flat discounts." actions={canWrite && <Button size="sm" onClick={() => setEditing('new')}><Plus /> New coupon</Button>} />
      <DataTable columns={columns} data={data} isLoading={isLoading} error={error} onRetry={() => void mutate()} getRowId={(c) => c.id}
        onRowClick={canWrite ? (c) => setEditing(c) : undefined} empty={{ icon: <TicketPercent />, title: 'No coupons yet' }} footer={<Pagination meta={meta} onPageChange={setPage} />} />
      {editing && <CouponDialog coupon={editing === 'new' ? undefined : editing} categories={categories ?? []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void mutate(); }} />}
    </>
  );
}

interface Values {
  code: string; description: string; type: 'PERCENTAGE' | 'FIXED'; value: string; maxDiscount: string; minOrderValue: string;
  startsAt: string; expiresAt: string; usageLimit: string; perUserLimit: string; isActive: boolean;
}

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function CouponDialog({ coupon, categories, onClose, onSaved }: { coupon?: CouponDto; categories: CategoryNode[]; onClose: () => void; onSaved: () => void }) {
  const [categoryIds, setCategoryIds] = React.useState<string[]>(coupon?.categoryIds ?? []);
  const { register, handleSubmit, setError, watch, setValue, formState: { errors, isSubmitting } } = useForm<Values>({
    defaultValues: {
      code: coupon?.code ?? '', description: coupon?.description ?? '', type: coupon?.type ?? 'PERCENTAGE', value: coupon ? String(coupon.value) : '',
      maxDiscount: coupon?.maxDiscount != null ? String(coupon.maxDiscount) : '', minOrderValue: coupon?.minOrderValue != null ? String(coupon.minOrderValue) : '',
      startsAt: toLocalInput(coupon?.startsAt ?? null), expiresAt: toLocalInput(coupon?.expiresAt ?? null),
      usageLimit: coupon?.usageLimit != null ? String(coupon.usageLimit) : '', perUserLimit: String(coupon?.perUserLimit ?? 1), isActive: coupon?.isActive ?? true,
    },
  });
  const type = watch('type');
  const flat = React.useMemo(() => flattenTree(categories), [categories]);

  const submit = handleSubmit(async (v) => {
    if (v.startsAt && v.expiresAt && new Date(v.expiresAt) <= new Date(v.startsAt)) { setError('expiresAt', { message: 'Must be after the start date' }); return; }
    const parsed = parseOrSetErrors(couponSchema, { ...blankToNull({ ...v, maxDiscount: v.type === 'PERCENTAGE' ? v.maxDiscount : '' }), categoryIds }, setError);
    if (!parsed) return;
    try {
      if (coupon) await api.patch(`/coupons/${coupon.id}`, parsed);
      else await api.post('/coupons', parsed);
      toast.success(coupon ? 'Coupon updated' : 'Coupon created');
      onSaved();
    } catch (err) {
      if (!applyApiErrors(err, setError)) setError('root.server', { message: errorMessage(err) });
    }
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={coupon ? `Edit ${coupon.code}` : 'New coupon'} size="lg" modalLock
      footer={<><Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" loading={isSubmitting} onClick={() => void submit()}>Save coupon</Button></>}>
      <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {errors.root?.server && <Alert tone="danger" className="sm:col-span-2">{errors.root.server.message}</Alert>}
        <Field label="Code" htmlFor="cp-code" error={errors.code?.message} hint="Letters and numbers, 3–30"><Input id="cp-code" className="font-mono uppercase" invalid={!!errors.code} {...register('code')} /></Field>
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Type</p>
          <Segmented label="Discount type" value={type} onChange={(t) => setValue('type', t)} options={[{ value: 'PERCENTAGE', label: 'Percentage' }, { value: 'FIXED', label: 'Flat ₹' }]} />
        </div>
        <Field label="Description" htmlFor="cp-desc" error={errors.description?.message} className="sm:col-span-2"><Textarea id="cp-desc" rows={2} maxLength={200} {...register('description')} /></Field>
        <Field label={type === 'PERCENTAGE' ? 'Discount %' : 'Discount ₹'} htmlFor="cp-value" error={errors.value?.message}><Input id="cp-value" type="number" inputMode="decimal" step="0.01" min={0} className="tabular" invalid={!!errors.value} {...register('value')} /></Field>
        {type === 'PERCENTAGE' ? (
          <Field label="Max discount ₹" htmlFor="cp-max" error={errors.maxDiscount?.message} hint="Optional cap"><Input id="cp-max" type="number" inputMode="decimal" step="0.01" min={0} className="tabular" {...register('maxDiscount')} /></Field>
        ) : <div />}
        <Field label="Minimum order ₹" htmlFor="cp-min" error={errors.minOrderValue?.message}><Input id="cp-min" type="number" inputMode="decimal" step="0.01" min={0} className="tabular" {...register('minOrderValue')} /></Field>
        <div />
        <Field label="Starts" htmlFor="cp-start" error={errors.startsAt?.message}><Input id="cp-start" type="datetime-local" {...register('startsAt')} /></Field>
        <Field label="Expires" htmlFor="cp-end" error={errors.expiresAt?.message}><Input id="cp-end" type="datetime-local" invalid={!!errors.expiresAt} {...register('expiresAt')} /></Field>
        <Field label="Total usage limit" htmlFor="cp-limit" error={errors.usageLimit?.message} hint="Blank = unlimited"><Input id="cp-limit" type="number" min={1} step={1} className="tabular" {...register('usageLimit')} /></Field>
        <Field label="Uses per customer" htmlFor="cp-peruser" error={errors.perUserLimit?.message}><Input id="cp-peruser" type="number" min={1} step={1} className="tabular" {...register('perUserLimit')} /></Field>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Category scope</legend>
          <p className="mb-2 text-xs text-muted">{categoryIds.length ? `Applies to ${categoryIds.length} selected categor${categoryIds.length === 1 ? 'y' : 'ies'} (incl. sub-categories).` : 'Applies to all products.'}</p>
          <div className="max-h-48 overflow-y-auto rounded-md border border-border p-2">
            {flat.length === 0 && <p className="p-1 text-xs text-muted">No categories available.</p>}
            {flat.map((c) => (
              <label key={c.id} className="flex items-center gap-2 rounded-sm px-1.5 py-1 text-sm hover:bg-surface" style={{ paddingLeft: 6 + c.depth * 16 }}>
                <Checkbox label={c.name} checked={categoryIds.includes(c.id)} onCheckedChange={(on) => setCategoryIds((ids) => (on ? [...ids, c.id] : ids.filter((x) => x !== c.id)))} />
                {c.name}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Switch id="cp-active" checked={watch('isActive')} onCheckedChange={(v) => setValue('isActive', v)} />
          <label htmlFor="cp-active" className="text-sm">Active</label>
        </div>
      </form>
    </Dialog>
  );
}
