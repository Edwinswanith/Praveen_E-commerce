'use client';
import * as React from 'react';
import { toast } from 'sonner';
import { promotionSchema, type CampaignAdminDto, type CategoryNode } from '@vyra/shared';
import { Alert, Badge, Button, Card, CardHeader, CardTitle, EmptyState, Field, Input, Skeleton } from '@vyra/ui';
import { Gift, Pencil, Plus, Trash2 } from 'lucide-react';
import { useApi } from '@/lib/swr';
import { api, errorMessage } from '@/lib/api';
import { formatINR, formatNumber } from '@/lib/format';
import { formatIstDateTime, istInputToIso, isoToIstInput } from '@/lib/ist';
import type { PromotionAdminDto } from '@/lib/types';
import { ErrorState } from '@/components/ui/feedback';
import { Dialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/controls';
import { useConfirm } from '@/components/ui/confirm';
import { flattenTree } from '@/features/categories/tree';
import { ProductPicker, type PickedProduct } from './product-picker';
import { hasStartedSelling } from './campaign-rules';

export function BundlesTab({ campaign, canWrite, canReadCatalog, onChanged }: { campaign: CampaignAdminDto; canWrite: boolean; canReadCatalog: boolean; onChanged: () => void }) {
  const confirm = useConfirm();
  const { data, error, isLoading, mutate } = useApi<PromotionAdminDto[]>('/promotions', { campaignId: campaign.id });
  const { data: tree } = useApi<CategoryNode[]>(canReadCatalog ? '/categories' : null);
  const names = React.useMemo(() => new Map(flattenTree(tree ?? []).map((c) => [c.id, c.name])), [tree]);
  const [editing, setEditing] = React.useState<PromotionAdminDto | 'new' | null>(null);
  const over = campaign.phase === 'ENDED' || campaign.phase === 'CANCELLED';
  const running = hasStartedSelling(campaign);

  const remove = async (p: PromotionAdminDto) => {
    if (!(await confirm({ title: `Remove "${p.name}"?`, description: p.usedCount ? 'It has been used on orders, so it is switched off instead of deleted (reports stay intact).' : undefined, confirmLabel: 'Remove', destructive: true }))) return;
    try { await api.delete(`/promotions/${p.id}`); toast.success('Bundle offer removed'); void mutate(); onChanged(); }
    catch (err) { toast.error(errorMessage(err)); }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Bundle offers</CardTitle>
        {canWrite && !over && <Button size="sm" className="max-sm:h-11" onClick={() => setEditing('new')}><Plus /> New bundle offer</Button>}
      </CardHeader>
      <p className="border-b border-border bg-surface px-4 py-2 text-xs text-muted">
        Extra % off when a shopper buys enough qualifying items, e.g. &quot;Buy 2, extra 10% off&quot;. It applies on top of sale prices.{running && ' While the sale runs, an offer can only get better for customers.'}
      </p>
      {error && !data ? <div className="p-4"><ErrorState error={error} onRetry={() => void mutate()} /></div>
        : isLoading && !data ? <div className="space-y-2 p-4"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
        : !data?.length ? <EmptyState icon={<Gift />} title="No bundle offers" description="Optional. A campaign needs at least one sale price or bundle offer to publish." className="py-12" />
        : (
          <ul className="divide-y divide-border">
            {data.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">{p.name}<Badge tone={p.isActive ? 'success' : 'neutral'}>{p.isActive ? 'Active' : 'Off'}</Badge></p>
                  <p className="text-sm">Buy {p.minQuantity}+, extra {p.percentOff}% off{p.maxDiscount != null ? ` (max ${formatINR(p.maxDiscount)})` : ''}</p>
                  <p className="text-xs text-muted">
                    {p.categoryIds.length || p.productIds.length
                      ? [p.categoryIds.length ? p.categoryIds.map((id) => names.get(id) ?? 'Category').join(', ') : null, p.productIds.length ? `${p.productIds.length} product${p.productIds.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' + ')
                      : 'All campaign products'}
                    {' · '}Used {formatNumber(p.usedCount)}{p.usageLimit ? ` / ${formatNumber(p.usageLimit)}` : ''}
                    {p.startsAt || p.endsAt ? ` · ${p.startsAt ? formatIstDateTime(p.startsAt) : 'campaign start'} to ${p.endsAt ? formatIstDateTime(p.endsAt) : 'campaign end'}` : ''}
                  </p>
                </div>
                {canWrite && !over && (
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="sm" className="max-sm:size-11" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}><Pencil /></Button>
                    <Button variant="ghost" size="sm" className="max-sm:size-11" onClick={() => void remove(p)} aria-label={`Remove ${p.name}`}><Trash2 /></Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      {editing && (
        <BundleDialog campaignId={campaign.id} promotion={editing === 'new' ? undefined : editing} tree={tree ?? []} running={running}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void mutate(); onChanged(); }} />
      )}
    </Card>
  );
}

function BundleDialog({ campaignId, promotion: p, tree, running, onClose, onSaved }: {
  campaignId: string; promotion?: PromotionAdminDto; tree: CategoryNode[]; running: boolean; onClose: () => void; onSaved: () => void;
}) {
  const flat = React.useMemo(() => flattenTree(tree), [tree]);
  const [v, setV] = React.useState({
    name: p?.name ?? '', minQuantity: String(p?.minQuantity ?? 2), percentOff: String(p?.percentOff ?? 10), maxDiscount: p?.maxDiscount != null ? String(p.maxDiscount) : '',
    usageLimit: p?.usageLimit != null ? String(p.usageLimit) : '', startsAt: isoToIstInput(p?.startsAt), endsAt: isoToIstInput(p?.endsAt), isActive: p?.isActive ?? true,
  });
  const [categoryIds, setCategoryIds] = React.useState<string[]>(p?.categoryIds ?? []);
  // Product names are not in the promotion payload; existing ids are kept and shown as a count.
  const [products, setProducts] = React.useState<PickedProduct[]>([]);
  const keptProductIds = p?.productIds ?? [];
  const [keepExisting, setKeepExisting] = React.useState(true);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);

  const save = async () => {
    const productIds = [...(keepExisting ? keptProductIds : []), ...products.map((x) => x.id)];
    const body = {
      name: v.name, campaignId, minQuantity: v.minQuantity, percentOff: v.percentOff,
      maxDiscount: v.maxDiscount.trim() || null, usageLimit: v.usageLimit.trim() || null,
      startsAt: v.startsAt ? istInputToIso(v.startsAt) : null, endsAt: v.endsAt ? istInputToIso(v.endsAt) : null,
      isActive: v.isActive, categoryIds, productIds: [...new Set(productIds)],
    };
    const errs: Record<string, string> = {};
    if (v.startsAt && !body.startsAt) errs.startsAt = 'Enter a valid date and time';
    if (v.endsAt && !body.endsAt) errs.endsAt = 'Enter a valid date and time';
    if (body.startsAt && body.endsAt && body.endsAt <= body.startsAt) errs.endsAt = 'Must be after the start';
    const parsed = promotionSchema.safeParse(body);
    if (!parsed.success) for (const i of parsed.error.issues) { const k = String(i.path[0] ?? 'root'); if (!errs[k]) errs[k] = i.message; }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setPending(true);
    try {
      // Always send the full payload: PATCH uses promotionSchema.partial(), whose defaults would otherwise reset scope/isActive.
      if (p) await api.patch(`/promotions/${p.id}`, body);
      else await api.post('/promotions', body);
      toast.success(p ? 'Bundle offer saved' : 'Bundle offer added');
      onSaved();
    } catch (err) {
      setErrors({ root: errorMessage(err) });
    } finally {
      setPending(false);
    }
  };

  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={p ? `Edit ${p.name}` : 'New bundle offer'} size="lg" modalLock
      footer={<><Button variant="ghost" size="sm" className="max-sm:h-11" onClick={onClose}>Cancel</Button><Button size="sm" className="max-sm:h-11" loading={pending} onClick={() => void save()}>Save offer</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {errors.root && <Alert tone="danger" className="sm:col-span-2">{errors.root}</Alert>}
        {running && p && <Alert tone="info" className="sm:col-span-2">The sale is running: you can raise the % or lower the quantity, not the other way round.</Alert>}
        <Field label="Name" htmlFor="bo-name" error={errors.name} hint="Shown to shoppers, e.g. Buy 2, extra 10% off" className="sm:col-span-2"><Input id="bo-name" maxLength={60} value={v.name} onChange={set('name')} invalid={!!errors.name} /></Field>
        <Field label="Minimum items" htmlFor="bo-min" error={errors.minQuantity} hint="2 to 10"><Input id="bo-min" type="number" inputMode="numeric" min={2} max={10} step={1} className="tabular" value={v.minQuantity} onChange={set('minQuantity')} /></Field>
        <Field label="Extra % off" htmlFor="bo-pct" error={errors.percentOff} hint="1 to 50"><Input id="bo-pct" type="number" inputMode="decimal" min={1} max={50} step="0.5" className="tabular" value={v.percentOff} onChange={set('percentOff')} /></Field>
        <Field label="Max discount ₹" htmlFor="bo-max" error={errors.maxDiscount} hint="Optional cap per order"><Input id="bo-max" type="number" inputMode="decimal" min={0} step="0.01" className="tabular" value={v.maxDiscount} onChange={set('maxDiscount')} /></Field>
        <Field label="Total uses" htmlFor="bo-limit" error={errors.usageLimit} hint="Blank = unlimited"><Input id="bo-limit" type="number" inputMode="numeric" min={1} step={1} className="tabular" value={v.usageLimit} onChange={set('usageLimit')} /></Field>
        <Field label="Starts (IST)" htmlFor="bo-start" error={errors.startsAt} hint="Blank = with the campaign"><Input id="bo-start" type="datetime-local" value={v.startsAt} onChange={set('startsAt')} /></Field>
        <Field label="Ends (IST)" htmlFor="bo-end" error={errors.endsAt} hint="Blank = with the campaign"><Input id="bo-end" type="datetime-local" value={v.endsAt} onChange={set('endsAt')} /></Field>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Qualifying items</legend>
          <p className="mb-2 text-xs text-muted">Nothing selected = every product in this campaign.</p>
          <div className="max-h-40 overflow-y-auto rounded-md border border-border p-1">
            {flat.length === 0 && <p className="p-2 text-xs text-muted">No categories available.</p>}
            {flat.map((c) => {
              const on = categoryIds.includes(c.id);
              return (
                <label key={c.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-1.5 text-sm hover:bg-surface sm:min-h-8" style={{ paddingLeft: 6 + c.depth * 16 }}>
                  <input type="checkbox" className="size-4" checked={on} onChange={() => setCategoryIds((ids) => (on ? ids.filter((x) => x !== c.id) : [...ids, c.id]))} />
                  {c.name}
                </label>
              );
            })}
          </div>
          <div className="mt-3">
            {keptProductIds.length > 0 && (
              <label className="mb-2 flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
                <input type="checkbox" className="size-4" checked={keepExisting} onChange={(e) => setKeepExisting(e.target.checked)} />
                Keep the {keptProductIds.length} product{keptProductIds.length === 1 ? '' : 's'} already selected
              </label>
            )}
            <ProductPicker value={products} onChange={setProducts} label="Add qualifying products" />
          </div>
        </fieldset>
        <label className="flex min-h-11 items-center gap-3 text-sm sm:col-span-2">
          <Switch checked={v.isActive} onCheckedChange={(on) => setV({ ...v, isActive: on })} label="Offer active" />
          Active
        </label>
      </div>
    </Dialog>
  );
}
