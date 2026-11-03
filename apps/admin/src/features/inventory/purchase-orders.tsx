'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import type { InventoryRowDto } from '@vyra/shared';
import { purchaseOrderSchema } from '@vyra/shared';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Skeleton, Textarea } from '@vyra/ui';
import { ArrowLeft, ClipboardList, PackageCheck, Plus, Trash2 } from 'lucide-react';
import { useApi } from '@/lib/swr';
import { api, ApiError, errorMessage } from '@/lib/api';
import { flattenFieldErrors } from '@/lib/forms';
import type { PurchaseOrderDto, SupplierDto } from '@/lib/types';
import { formatDate, formatDateTime, formatINR, formatNumber, humanize } from '@/lib/format';
import { DataTable } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import { ErrorState, KeyValue, PageHeader } from '@/components/ui/feedback';
import { Select } from '@/components/ui/controls';
import { useConfirm } from '@/components/ui/confirm';
import { VariantPicker } from './variant-picker';

const PO_TONE: Record<string, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  DRAFT: 'neutral', ORDERED: 'info', PARTIALLY_RECEIVED: 'warning', RECEIVED: 'success', CANCELLED: 'danger',
};
const poTotal = (po: PurchaseOrderDto) => po.totalCost ?? (po.items ?? []).reduce((s, i) => s + i.quantity * i.unitCost, 0);
const backLink = <Link href="/inventory/purchase-orders" className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-fg"><ArrowLeft className="size-3.5" /> Purchase orders</Link>;

const listColumns: ColumnDef<PurchaseOrderDto, unknown>[] = [
  { header: 'PO', id: 'number', cell: ({ row }) => <span className="font-medium">{row.original.number ?? row.original.id.slice(-8).toUpperCase()}</span> },
  { header: 'Supplier', id: 'supplier', cell: ({ row }) => row.original.supplier?.name ?? row.original.supplierName ?? '—' },
  { header: 'Reference', accessorKey: 'reference', cell: ({ row }) => <span className="font-mono text-xs">{row.original.reference ?? '—'}</span> },
  { header: 'Status', accessorKey: 'status', cell: ({ row }) => <Badge tone={PO_TONE[row.original.status] ?? 'neutral'}>{humanize(row.original.status)}</Badge> },
  { header: 'Items', id: 'items', meta: { align: 'right' }, cell: ({ row }) => formatNumber(row.original.itemCount ?? row.original.items?.length ?? 0) },
  { header: 'Total', id: 'total', meta: { align: 'right' }, cell: ({ row }) => formatINR(poTotal(row.original)) },
  { header: 'Created', accessorKey: 'createdAt', cell: ({ row }) => <span className="text-muted">{formatDate(row.original.orderedAt ?? row.original.createdAt)}</span> },
];

export function PurchaseOrdersList() {
  const router = useRouter();
  const [page, setPage] = React.useState(1);
  const { data, meta, error, isLoading, mutate } = useApi<PurchaseOrderDto[]>('/purchase-orders', { page, pageSize: 20 });
  return (
    <>
      <PageHeader title="Purchase orders" description="Order stock from suppliers and receive it into inventory." actions={<Button asChild size="sm"><Link href="/inventory/purchase-orders/new"><Plus /> New purchase order</Link></Button>} />
      <DataTable columns={listColumns} data={data} isLoading={isLoading} error={error} onRetry={() => void mutate()} getRowId={(p) => p.id}
        onRowClick={(p) => router.push(`/inventory/purchase-orders/${p.id}`)} empty={{ icon: <ClipboardList />, title: 'No purchase orders yet' }}
        footer={<Pagination meta={meta} onPageChange={setPage} />} />
    </>
  );
}

interface DraftLine { variantId: string; sku: string; productName: string; color: string; size: string; quantity: string; unitCost: string }

export function PurchaseOrderCreate() {
  const router = useRouter();
  const { data: suppliers, isLoading: supLoading } = useApi<SupplierDto[]>('/suppliers', { pageSize: 100 });
  const [supplierId, setSupplierId] = React.useState('');
  const [reference, setReference] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [lines, setLines] = React.useState<DraftLine[]>([]);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);

  const addLine = (r: InventoryRowDto) => setLines((ls) => [...ls, { variantId: r.variantId, sku: r.sku, productName: r.productName, color: r.color, size: r.size, quantity: '1', unitCost: r.costPrice !== null ? String(r.costPrice) : '' }]);
  const update = (i: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0);

  const submit = async () => {
    const body = {
      supplierId, reference: reference || null, notes: notes || null,
      items: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, unitCost: l.unitCost === '' ? NaN : l.unitCost })),
    };
    const parsed = purchaseOrderSchema.safeParse(body);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => {
        const [head, idx, field] = i.path;
        if (head === 'items' && typeof idx === 'number') return `Line ${idx + 1} (${lines[idx]?.sku ?? ''}) ${String(field ?? '')}: ${i.message}`;
        if (head === 'supplierId') return 'Choose a supplier';
        if (head === 'items') return 'Add at least one item';
        return i.message;
      }));
      return;
    }
    setErrors([]);
    setSaving(true);
    try {
      const po = await api.post<PurchaseOrderDto>('/purchase-orders', parsed.data);
      toast.success('Purchase order created');
      router.replace(`/inventory/purchase-orders/${po.id}`);
    } catch (err) {
      const fe = flattenFieldErrors(err);
      setErrors(fe.length ? fe.map((f) => `${f.field}: ${f.message}`) : [errorMessage(err)]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader back={backLink} title="New purchase order" actions={<Button size="sm" loading={saving} onClick={() => void submit()}>Create purchase order</Button>} />
      {errors.length > 0 && <Alert tone="danger" title="Please fix the following" className="mb-4"><ul className="list-disc pl-4">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Alert>}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Items</CardTitle><span className="tabular text-sm font-semibold">{formatINR(total)}</span></CardHeader>
          <CardContent className="space-y-4">
            <VariantPicker onPick={addLine} excludeIds={new Set(lines.map((l) => l.variantId))} />
            {lines.length === 0 ? <p className="py-6 text-center text-sm text-muted">Search for variants to add them to this order.</p> : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-surface text-xs text-muted"><tr><th className="px-3 py-2 text-left font-medium">Variant</th><th className="px-2 py-2 text-right font-medium">Qty</th><th className="px-2 py-2 text-right font-medium">Unit cost ₹</th><th className="px-3 py-2 text-right font-medium">Line total</th><th className="w-10" /></tr></thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={l.variantId} className="border-t border-border">
                        <td className="px-3 py-2"><span className="block font-medium">{l.productName}</span><span className="font-mono text-xs text-muted">{l.sku} · {l.color}/{l.size}</span></td>
                        <td className="px-2 py-2 text-right"><input aria-label={`Quantity for ${l.sku}`} type="number" min={1} step={1} value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} className="tabular h-8 w-20 rounded-sm border border-border px-2 text-right focus:border-fg focus:outline-none" /></td>
                        <td className="px-2 py-2 text-right"><input aria-label={`Unit cost for ${l.sku}`} type="number" min={0} step="0.01" value={l.unitCost} onChange={(e) => update(i, { unitCost: e.target.value })} className="tabular h-8 w-24 rounded-sm border border-border px-2 text-right focus:border-fg focus:outline-none" /></td>
                        <td className="tabular px-3 py-2 text-right">{formatINR((Number(l.quantity) || 0) * (Number(l.unitCost) || 0))}</td>
                        <td className="px-1"><button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="rounded-sm p-1.5 text-muted hover:text-danger" aria-label={`Remove ${l.sku}`}><Trash2 className="size-4" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Order details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Field label="Supplier" htmlFor="po-sup" hint={!supLoading && !suppliers?.length ? 'No suppliers yet — create one under Suppliers.' : undefined}>
              <Select id="po-sup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Select a supplier</option>
                {(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Supplier reference" htmlFor="po-ref" hint="Quote / proforma number"><Input id="po-ref" maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
            <Field label="Notes" htmlFor="po-notes"><Textarea id="po-notes" rows={4} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export function PurchaseOrderDetail({ id }: { id: string }) {
  const { data: po, error, isLoading, mutate } = useApi<PurchaseOrderDto>(`/purchase-orders/${id}`);
  const confirm = useConfirm();
  const [receive, setReceive] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (po?.items) setReceive(Object.fromEntries(po.items.map((i) => [i.id, String(Math.max(0, i.quantity - (i.receivedQuantity ?? 0)))])));
  }, [po]);

  if (error && !po) return <>{backLink}<ErrorState error={error} onRetry={() => void mutate()} /></>;
  if (isLoading || !po) return <div className="space-y-4"><Skeleton className="h-8 w-60" /><Skeleton className="h-72" /></div>;

  const items = po.items ?? [];
  const outstanding = items.filter((i) => i.quantity - (i.receivedQuantity ?? 0) > 0);
  const toReceive = items.map((i) => ({ itemId: i.id, quantity: Math.trunc(Number(receive[i.id] ?? 0)) })).filter((x) => x.quantity > 0);
  const invalid = items.some((i) => { const q = Number(receive[i.id] ?? 0); return q < 0 || q > i.quantity - (i.receivedQuantity ?? 0); });

  const submitReceive = async () => {
    const units = toReceive.reduce((s, x) => s + x.quantity, 0);
    if (!(await confirm({ title: `Receive ${units} unit(s) into stock?`, description: 'Stock-in movements will be recorded against this purchase order.', confirmLabel: 'Receive stock' }))) return;
    setSaving(true);
    try {
      await api.post(`/purchase-orders/${po.id}/receive`, { items: toReceive });
      toast.success(`${units} unit(s) received`);
      void mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader back={backLink} title={`Purchase order ${po.number ?? po.id.slice(-8).toUpperCase()}`}
        description={<Badge tone={PO_TONE[po.status] ?? 'neutral'}>{humanize(po.status)}</Badge>}
        actions={outstanding.length > 0 && <Button size="sm" loading={saving} disabled={!toReceive.length || invalid} onClick={() => void submitReceive()}><PackageCheck /> Receive selected</Button>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2 overflow-hidden">
          <CardHeader><CardTitle>Items</CardTitle><span className="tabular text-sm font-semibold">{formatINR(poTotal(po))}</span></CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface text-xs text-muted"><tr><th className="px-4 py-2 text-left font-medium">Variant</th><th className="px-3 py-2 text-right font-medium">Ordered</th><th className="px-3 py-2 text-right font-medium">Received</th><th className="px-3 py-2 text-right font-medium">Unit cost</th><th className="px-4 py-2 text-right font-medium">Receive now</th></tr></thead>
              <tbody>
                {items.map((i) => {
                  const remaining = i.quantity - (i.receivedQuantity ?? 0);
                  return (
                    <tr key={i.id} className="border-t border-border">
                      <td className="px-4 py-2"><span className="block font-medium">{i.productName}</span><span className="font-mono text-xs text-muted">{i.sku}{i.color ? ` · ${i.color}/${i.size}` : ''}</span></td>
                      <td className="tabular px-3 py-2 text-right">{formatNumber(i.quantity)}</td>
                      <td className="tabular px-3 py-2 text-right">{formatNumber(i.receivedQuantity ?? 0)}</td>
                      <td className="tabular px-3 py-2 text-right">{formatINR(i.unitCost)}</td>
                      <td className="px-4 py-2 text-right">
                        {remaining > 0 ? (
                          <input aria-label={`Receive quantity for ${i.sku}`} type="number" min={0} max={remaining} step={1} value={receive[i.id] ?? ''} onChange={(e) => setReceive((r) => ({ ...r, [i.id]: e.target.value }))}
                            className="tabular h-8 w-20 rounded-sm border border-border px-2 text-right focus:border-fg focus:outline-none aria-[invalid=true]:border-danger"
                            aria-invalid={Number(receive[i.id] ?? 0) > remaining || undefined} />
                        ) : <Badge tone="success">Complete</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {invalid && <p className="px-4 py-2 text-xs text-danger">Receive quantities cannot exceed the outstanding quantity.</p>}
        </Card>
        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent>
            <KeyValue items={[
              { label: 'Supplier', value: po.supplier?.name ?? po.supplierName ?? '—' },
              { label: 'Reference', value: po.reference ?? '—' },
              { label: 'Ordered', value: formatDateTime(po.orderedAt ?? po.createdAt) },
              { label: 'Received', value: po.receivedAt ? formatDateTime(po.receivedAt) : '—' },
              { label: 'Notes', value: po.notes ?? '—' },
            ]} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
