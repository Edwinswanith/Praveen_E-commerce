'use client';
import * as React from 'react';
import { toast } from 'sonner';
import { bulkSalePrice, type CampaignAdminDto, type CampaignPriceRowDto, type CategoryNode } from '@vyra/shared';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Field, Input, Skeleton, cn } from '@vyra/ui';
import { AlertTriangle, Check, Pencil, Tags, Trash2, X } from 'lucide-react';
import { useApi } from '@/lib/swr';
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatINR, formatNumber } from '@/lib/format';
import type { CampaignBulkResultDto } from '@/lib/types';
import { ErrorState } from '@/components/ui/feedback';
import { Switch } from '@/components/ui/controls';
import { useConfirm } from '@/components/ui/confirm';
import { SearchInput } from '@/components/data-table/search-input';
import { flattenTree } from '@/features/categories/tree';
import { priceRules, validatePriceEdit, type PriceEdit } from './campaign-rules';
import { ProductPicker, type PickedProduct } from './product-picker';

type Rules = ReturnType<typeof priceRules>;

/** Messages from a failed API call: the headline plus every formErrors line (e.g. each below-cost price). */
export function apiErrorLines(err: unknown): string[] {
  const lines = [errorMessage(err), ...(err instanceof ApiError ? err.formErrors : [])];
  return lines.filter((m, i) => lines.indexOf(m) === i);
}

export function PricesTab({ campaign, canWrite, canReadCatalog, onChanged }: { campaign: CampaignAdminDto; canWrite: boolean; canReadCatalog: boolean; onChanged: () => void }) {
  const confirm = useConfirm();
  const { data, error, isLoading, mutate } = useApi<CampaignPriceRowDto[]>(`/campaigns/${campaign.id}/prices`);
  const rules = priceRules(campaign);
  const [q, setQ] = React.useState('');
  const [warnOnly, setWarnOnly] = React.useState(false);

  const rows = React.useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? []).filter((r) => (!warnOnly || r.warnings.length) && (!term || `${r.productName} ${r.sku} ${r.color} ${r.size}`.toLowerCase().includes(term)));
  }, [data, q, warnOnly]);
  const warnCount = (data ?? []).filter((r) => r.warnings.length).length;

  const save = async (row: CampaignPriceRowDto, edit: PriceEdit): Promise<string[] | null> => {
    try {
      const next = await api.put<CampaignPriceRowDto[]>(`/campaigns/${campaign.id}/prices`, {
        items: [{
          variantId: row.variantId, salePrice: Number(edit.salePrice),
          stockCap: edit.stockCap.trim() ? Number(edit.stockCap) : null,
          perCustomerLimit: edit.perCustomerLimit.trim() ? Number(edit.perCustomerLimit) : null,
        }],
      });
      void mutate({ data: next, extra: {} }, { revalidate: false });
      toast.success('Sale price saved');
      onChanged();
      return null;
    } catch (err) {
      return apiErrorLines(err);
    }
  };

  const remove = async (row: CampaignPriceRowDto) => {
    if (!(await confirm({ title: `Remove deal on ${row.productName} ${row.color}/${row.size}?`, description: 'The variant goes back to its regular price in this campaign.', confirmLabel: 'Remove', destructive: true }))) return;
    try {
      await api.delete(`/campaigns/${campaign.id}/prices/${row.variantId}`);
      toast.success('Deal removed');
      void mutate();
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-5">
      {canWrite && !rules.readOnly && (
        <BulkRuleForm campaignId={campaign.id} canReadCatalog={canReadCatalog} onApplied={(r) => { void mutate({ data: r.rows, extra: {} }, { revalidate: false }); onChanged(); }} />
      )}
      <Card className="overflow-hidden">
        <CardHeader className="flex-wrap">
          <CardTitle>Sale prices <span className="font-normal text-muted">({formatNumber(data?.length ?? 0)})</span></CardTitle>
          <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
            <SearchInput value={q} onChange={setQ} placeholder="Filter product or SKU" className="sm:w-60" />
            <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
              <Switch checked={warnOnly} onCheckedChange={setWarnOnly} label="Only rows with warnings" />
              With warnings{warnCount ? ` (${warnCount})` : ''}
            </label>
          </div>
        </CardHeader>
        <RulesNote rules={rules} />
        {error && !data ? <div className="p-4"><ErrorState error={error} onRetry={() => void mutate()} /></div>
          : isLoading && !data ? <div className="space-y-2 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          : !data?.length ? <EmptyState icon={<Tags />} title="No sale prices yet" description={canWrite ? 'Use a bulk rule above to price whole categories or products in one go.' : undefined} className="py-12" />
          : <PriceTable rows={rows} rules={rules} canWrite={canWrite} onSave={save} onRemove={(r) => void remove(r)} />}
      </Card>
    </div>
  );
}

function RulesNote({ rules }: { rules: Rules }) {
  if (rules.readOnly) return <p className="border-b border-border bg-surface px-4 py-2 text-xs text-muted">This campaign is over. Prices are read-only and kept for the report.</p>;
  return (
    <ul className="space-y-0.5 border-b border-border bg-surface px-4 py-2 text-xs text-muted">
      <li>Sale prices must be below the regular price and never below cost.</li>
      {rules.onlyDown && <li className="font-medium text-fg">The sale is running: prices can only go down, and a cap cannot drop below units already sold.</li>}
      {!rules.canRemove && <li>Deals cannot be removed now (they were advertised). Set a stock cap instead.</li>}
    </ul>
  );
}

const th = 'whitespace-nowrap px-3 py-2.5 text-xs font-medium text-muted';

export function PriceTable({ rows, rules, canWrite, onSave, onRemove }: {
  rows: CampaignPriceRowDto[]; rules: Rules; canWrite: boolean;
  onSave: (row: CampaignPriceRowDto, edit: PriceEdit) => Promise<string[] | null>; onRemove: (row: CampaignPriceRowDto) => void;
}) {
  const [editing, setEditing] = React.useState<string | null>(null);
  const editable = canWrite && !rules.readOnly;
  const cols = editable ? 11 : 10;
  if (!rows.length) return <p className="px-4 py-8 text-center text-sm text-muted">No rows match the filter.</p>;
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-surface text-left">
            <th scope="col" className={cn(th, 'pl-4')}>Product</th>
            <th scope="col" className={cn(th, 'text-right')}>MRP</th>
            <th scope="col" className={cn(th, 'text-right')}>Regular</th>
            <th scope="col" className={cn(th, 'text-right')}>Cost</th>
            <th scope="col" className={cn(th, 'text-right')}>Sale</th>
            <th scope="col" className={cn(th, 'text-right')}>Off regular</th>
            <th scope="col" className={cn(th, 'text-right')}>Off MRP</th>
            <th scope="col" className={cn(th, 'text-right')}>Sold / cap</th>
            <th scope="col" className={cn(th, 'text-right')}>Per customer</th>
            <th scope="col" className={cn(th, 'text-right')}>Available</th>
            {editable && <th scope="col" className={cn(th, 'pr-4')}><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => editing === r.variantId
            ? <EditRow key={r.variantId} row={r} rules={rules} cols={cols} onCancel={() => setEditing(null)} onSave={async (e) => { const errs = await onSave(r, e); if (!errs) setEditing(null); return errs; }} />
            : <ViewRow key={r.variantId} row={r} rules={rules} editable={editable} cols={cols} onEdit={() => setEditing(r.variantId)} onRemove={() => onRemove(r)} />)}
        </tbody>
      </table>
    </div>
  );
}

function ProductCell({ r }: { r: CampaignPriceRowDto }) {
  return (
    <div className="flex min-w-52 items-center gap-2.5">
      <span className="size-9 shrink-0 overflow-hidden rounded bg-surface-2">{r.imageUrl && <img src={r.imageUrl} alt="" className="size-full object-cover" />}</span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{r.productName}</span>
        <span className="block font-mono text-xs text-muted">{r.sku} · {r.color}/{r.size}</span>
      </span>
    </div>
  );
}

function ViewRow({ row: r, rules, editable, cols, onEdit, onRemove }: { row: CampaignPriceRowDto; rules: Rules; editable: boolean; cols: number; onEdit: () => void; onRemove: () => void }) {
  const warn = r.warnings.length > 0;
  const belowCost = r.costPrice != null && r.salePrice < r.costPrice;
  const td = 'px-3 py-2 align-middle';
  return (
    <>
      <tr className={cn('border-b border-border', warn && 'border-b-0 bg-amber-50/60')} data-warning={warn || undefined}>
        <td className={cn(td, 'pl-4')}><ProductCell r={r} /></td>
        <td className={cn(td, 'tabular text-right text-muted')}>{formatINR(r.mrp)}</td>
        <td className={cn(td, 'tabular text-right')}>{formatINR(r.regularPrice)}</td>
        <td className={cn(td, 'tabular text-right text-muted')}>{r.costPrice != null ? formatINR(r.costPrice) : 'Not set'}</td>
        <td className={cn(td, 'tabular text-right font-semibold', belowCost && 'text-danger')}>{formatINR(r.salePrice)}</td>
        <td className={cn(td, 'tabular text-right')}>{r.percentOffRegular}%</td>
        <td className={cn(td, 'tabular text-right text-muted')}>{r.percentOffMrp}%</td>
        <td className={cn(td, 'tabular whitespace-nowrap text-right')}>{formatNumber(r.soldCount)} / {r.stockCap != null ? formatNumber(r.stockCap) : 'no cap'}</td>
        <td className={cn(td, 'tabular text-right')}>{r.perCustomerLimit ?? 'Any'}</td>
        <td className={cn(td, 'tabular text-right', r.available === 0 && 'font-semibold text-danger')}>{formatNumber(r.available)}</td>
        {editable && (
          <td className={cn(td, 'pr-4')}>
            <div className="flex justify-end gap-1">
              <Button variant="ghost" size="sm" className="max-sm:size-11" onClick={onEdit} aria-label={`Edit ${r.sku}`}><Pencil /></Button>
              <Button variant="ghost" size="sm" className="max-sm:size-11" onClick={onRemove} disabled={!rules.canRemove} title={rules.removeReason ?? undefined} aria-label={`Remove deal ${r.sku}`}><Trash2 /></Button>
            </div>
          </td>
        )}
      </tr>
      {warn && (
        <tr className="border-b border-border bg-amber-50/60">
          <td colSpan={cols} className="px-4 pb-2 pt-0">
            <ul className="flex flex-wrap gap-1.5" aria-label={`Warnings for ${r.sku}`}>
              {r.warnings.map((w) => <li key={w}><Badge tone={/below cost/i.test(w) ? 'danger' : 'warning'} className="normal-case tracking-normal"><AlertTriangle className="size-3" aria-hidden />{w}</Badge></li>)}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

function EditRow({ row: r, rules, cols, onSave, onCancel }: { row: CampaignPriceRowDto; rules: Rules; cols: number; onSave: (e: PriceEdit) => Promise<string[] | null>; onCancel: () => void }) {
  const [edit, setEdit] = React.useState<PriceEdit>({ salePrice: String(r.salePrice), stockCap: r.stockCap != null ? String(r.stockCap) : '', perCustomerLimit: r.perCustomerLimit != null ? String(r.perCustomerLimit) : '' });
  const [errors, setErrors] = React.useState<string[]>([]);
  const [pending, setPending] = React.useState(false);
  const sale = Number(edit.salePrice);
  const off = (base: number) => (Number.isFinite(sale) && sale > 0 && sale < base ? Math.round(((base - sale) / base) * 100) : 0);
  const submit = async () => {
    const local = validatePriceEdit(r, edit, rules);
    setErrors(local);
    if (local.length) return;
    setPending(true);
    const server = await onSave(edit);
    setPending(false);
    if (server) setErrors(server);
  };
  const td = 'px-3 py-2 align-middle';
  const inputCls = 'h-11 w-24 text-right tabular sm:h-9';
  return (
    <>
      <tr className="border-b-0 bg-blue-50/50" data-editing>
        <td className={cn(td, 'pl-4')}><ProductCell r={r} /></td>
        <td className={cn(td, 'tabular text-right text-muted')}>{formatINR(r.mrp)}</td>
        <td className={cn(td, 'tabular text-right')}>{formatINR(r.regularPrice)}</td>
        <td className={cn(td, 'tabular text-right text-muted')}>{r.costPrice != null ? formatINR(r.costPrice) : 'Not set'}</td>
        <td className={cn(td, 'text-right')}>
          <Input aria-label={`Sale price for ${r.sku}`} type="number" inputMode="decimal" step="0.01" min={0} className={inputCls} value={edit.salePrice}
            onChange={(e) => setEdit({ ...edit, salePrice: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') void submit(); if (e.key === 'Escape') onCancel(); }} autoFocus />
        </td>
        <td className={cn(td, 'tabular text-right')}>{off(r.regularPrice)}%</td>
        <td className={cn(td, 'tabular text-right text-muted')}>{off(r.mrp)}%</td>
        <td className={cn(td, 'text-right')}>
          <span className="inline-flex items-center gap-1 whitespace-nowrap"><span className="tabular text-xs text-muted">{r.soldCount} /</span>
            <Input aria-label={`Stock cap for ${r.sku}`} type="number" inputMode="numeric" min={1} step={1} placeholder="No cap" className={inputCls} value={edit.stockCap} onChange={(e) => setEdit({ ...edit, stockCap: e.target.value })} />
          </span>
        </td>
        <td className={cn(td, 'text-right')}>
          <Input aria-label={`Per-customer limit for ${r.sku}`} type="number" inputMode="numeric" min={1} max={50} step={1} placeholder="Any" className={inputCls} value={edit.perCustomerLimit} onChange={(e) => setEdit({ ...edit, perCustomerLimit: e.target.value })} />
        </td>
        <td className={cn(td, 'tabular text-right')}>{formatNumber(r.available)}</td>
        <td className={cn(td, 'pr-4')}>
          <div className="flex justify-end gap-1">
            <Button size="sm" className="max-sm:size-11" loading={pending} onClick={() => void submit()} aria-label={`Save ${r.sku}`}><Check /></Button>
            <Button variant="ghost" size="sm" className="max-sm:size-11" onClick={onCancel} aria-label="Cancel edit"><X /></Button>
          </div>
        </td>
      </tr>
      <tr className="border-b border-border bg-blue-50/50">
        <td colSpan={cols} className="px-4 pb-2 pt-0">
          {errors.length > 0 ? (
            <ul role="alert" className="space-y-0.5 text-xs text-danger">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
          ) : (
            <p className="text-xs text-muted">Below {formatINR(r.regularPrice)}{r.costPrice != null ? `, at least cost ${formatINR(r.costPrice)}` : ''}{rules.onlyDown ? `, and not above the current ${formatINR(r.salePrice)}` : ''}. Blank cap or limit means none.</p>
          )}
        </td>
      </tr>
    </>
  );
}

function BulkRuleForm({ campaignId, canReadCatalog, onApplied }: { campaignId: string; canReadCatalog: boolean; onApplied: (r: CampaignBulkResultDto) => void }) {
  const { data: tree } = useApi<CategoryNode[]>(canReadCatalog ? '/categories' : null);
  const flat = React.useMemo(() => flattenTree(tree ?? []), [tree]);
  const [categoryIds, setCategoryIds] = React.useState<string[]>([]);
  const [products, setProducts] = React.useState<PickedProduct[]>([]);
  const [percent, setPercent] = React.useState('20');
  const [roundToNine, setRoundToNine] = React.useState(true);
  const [cap, setCap] = React.useState('');
  const [limit, setLimit] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<{ applied: number; skipped: number } | null>(null);
  const [errors, setErrors] = React.useState<string[]>([]);

  const pct = Number(percent);
  const pctOk = Number.isFinite(pct) && pct >= 1 && pct <= 90;
  const example = pctOk ? bulkSalePrice(99900, pct, roundToNine) / 100 : null;

  const submit = async () => {
    const errs: string[] = [];
    if (!categoryIds.length && !products.length) errs.push('Pick at least one category or product');
    if (!pctOk) errs.push('% off must be between 1 and 90');
    if (cap && !(Number.isInteger(Number(cap)) && Number(cap) >= 1)) errs.push('Cap must be a whole number from 1');
    if (limit && !(Number.isInteger(Number(limit)) && Number(limit) >= 1 && Number(limit) <= 50)) errs.push('Per-customer limit must be 1 to 50');
    setErrors(errs); setResult(null);
    if (errs.length) return;
    setPending(true);
    try {
      const r = await api.post<CampaignBulkResultDto>(`/campaigns/${campaignId}/prices/bulk`, {
        categoryIds, productIds: products.map((p) => p.id), percentOff: pct, roundToNine,
        stockCap: cap ? Number(cap) : null, perCustomerLimit: limit ? Number(limit) : null,
      });
      setResult({ applied: r.applied, skipped: r.skippedBelowCost });
      onApplied(r);
      toast.success(`${r.applied} sale price${r.applied === 1 ? '' : 's'} set`);
    } catch (err) {
      setErrors(apiErrorLines(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle>Bulk rule</CardTitle><span className="text-xs text-muted">Sets a sale price on every active variant that matches</span></CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-2">
        <fieldset>
          <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Categories</legend>
          <p className="mb-2 text-xs text-muted">{categoryIds.length ? `${categoryIds.length} selected (sub-categories included)` : 'None selected'}</p>
          <div className="max-h-52 overflow-y-auto rounded-md border border-border p-1">
            {!canReadCatalog && <p className="p-2 text-xs text-muted">You need catalog access to list categories. Pick products instead.</p>}
            {canReadCatalog && flat.length === 0 && <p className="p-2 text-xs text-muted">No categories.</p>}
            {flat.map((c) => {
              const on = categoryIds.includes(c.id);
              return (
                <label key={c.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-1.5 text-sm hover:bg-surface sm:min-h-8" style={{ paddingLeft: 6 + c.depth * 16 }}>
                  <input type="checkbox" className="size-4 accent-current" checked={on} onChange={() => setCategoryIds((ids) => (on ? ids.filter((x) => x !== c.id) : [...ids, c.id]))} />
                  {c.name}
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">And/or products</p>
            <ProductPicker value={products} onChange={setProducts} label="Add products to the bulk rule" />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="% off regular" htmlFor="bulk-pct" hint="1 to 90">
              <Input id="bulk-pct" type="number" inputMode="decimal" min={1} max={90} step="0.5" className="tabular max-sm:h-11" value={percent} onChange={(e) => setPercent(e.target.value)} />
            </Field>
            <Field label="Stock cap" htmlFor="bulk-cap" hint="Per variant, blank = none">
              <Input id="bulk-cap" type="number" inputMode="numeric" min={1} step={1} className="tabular max-sm:h-11" value={cap} onChange={(e) => setCap(e.target.value)} />
            </Field>
            <Field label="Per customer" htmlFor="bulk-limit" hint="Blank = any">
              <Input id="bulk-limit" type="number" inputMode="numeric" min={1} max={50} step={1} className="tabular max-sm:h-11" value={limit} onChange={(e) => setLimit(e.target.value)} />
            </Field>
          </div>
          <label className="flex min-h-11 items-center gap-3 text-sm sm:min-h-0">
            <Switch checked={roundToNine} onCheckedChange={setRoundToNine} label="Round down to a price ending in 9" />
            Round down to ₹…9 (₹712 becomes ₹709)
          </label>
          <p className="text-xs text-muted">
            The percentage is taken off the regular selling price, not MRP, and always rounded down so the real discount is at least what you set.
            {example != null && <> Example: regular ₹999 becomes {formatINR(example)}.</>} Variants whose sale price would fall below cost are skipped.
          </p>
          {errors.length > 0 && <Alert tone="danger"><ul className="space-y-0.5">{errors.map((e) => <li key={e}>{e}</li>)}</ul></Alert>}
          {result && (
            <Alert tone={result.skipped ? 'warning' : 'success'}>
              {result.applied} sale price{result.applied === 1 ? '' : 's'} applied.{result.skipped ? ` ${result.skipped} skipped because the price would be below cost.` : ' None skipped.'}
            </Alert>
          )}
          <div className="flex justify-end">
            <Button size="sm" className="max-sm:h-11" loading={pending} onClick={() => void submit()}>Apply rule</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
