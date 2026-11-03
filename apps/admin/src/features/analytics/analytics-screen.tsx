'use client';
import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, Skeleton } from '@vyra/ui';
import { Download } from 'lucide-react';
import type { CodAnalyticsDto, ProductReturnRateDto } from '@vyra/shared';
import { CodKpis } from '@/features/cod/cod-kpis';
import Link from 'next/link';
import { useApi } from '@/lib/swr';
import { errorMessage } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { useUrlState } from '@/hooks/use-url-state';
import type { CancellationReport, InventoryAnalyticsDto, ProductAnalyticsRow, ReturnsReport, SalesAnalyticsDto } from '@/lib/types';
import { dayToIso, daysAgo, formatINR, formatNumber, humanize, isoDay } from '@/lib/format';
import { DataTable } from '@/components/data-table/data-table';
import { ErrorState, PageHeader, StatCard } from '@/components/ui/feedback';
import { Segmented } from '@/components/ui/controls';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { BarList, TimeSeriesChart } from '@/features/charts/time-series-chart';

type Granularity = 'day' | 'week' | 'month';
const PRESETS = [{ label: '7d', days: 7 }, { label: '30d', days: 30 }, { label: '90d', days: 90 }, { label: '12m', days: 365 }];

const productCols: ColumnDef<ProductAnalyticsRow, unknown>[] = [
  { header: 'Product', accessorKey: 'name', cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
  { header: 'Units', accessorKey: 'units', meta: { align: 'right' }, cell: ({ row }) => formatNumber(row.original.units) },
  { header: 'Revenue', accessorKey: 'revenue', meta: { align: 'right' }, cell: ({ row }) => formatINR(row.original.revenue) },
  { header: 'Returns', accessorKey: 'returns', meta: { align: 'right' }, cell: ({ row }) => <span className={row.original.returns ? 'text-warning' : 'text-muted'}>{formatNumber(row.original.returns)}</span> },
  { header: 'Return rate', id: 'rate', meta: { align: 'right' }, cell: ({ row: { original: r } }) => <span className="text-muted">{r.units ? `${((r.returns / r.units) * 100).toFixed(1)}%` : '—'}</span> },
];

/** Return rate (%) at or above which a product is flagged for review (sizing, quality, photos). */
export const HIGH_RETURN_RATE = 20;

const returnRateCols: ColumnDef<ProductReturnRateDto, unknown>[] = [
  { header: 'Product', accessorKey: 'name', cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
  { header: 'Sold', accessorKey: 'unitsSold', meta: { align: 'right' }, cell: ({ row }) => formatNumber(row.original.unitsSold) },
  { header: 'Returned', accessorKey: 'unitsReturned', meta: { align: 'right' }, cell: ({ row }) => formatNumber(row.original.unitsReturned) },
  {
    header: 'Return rate', accessorKey: 'returnRate', meta: { align: 'right' },
    cell: ({ row: { original: r } }) => r.returnRate >= HIGH_RETURN_RATE
      ? <Badge tone="danger" title="High return rate: check sizing, photos and quality">{r.returnRate.toFixed(1)}%</Badge>
      : <span className={r.returnRate > 0 ? 'text-warning' : 'text-muted'}>{r.returnRate.toFixed(1)}%</span>,
  },
  { header: 'Exchanges', accessorKey: 'exchanges', meta: { align: 'right' }, cell: ({ row }) => <span className="text-muted">{formatNumber(row.original.exchanges)}</span> },
  { header: 'Top reason', accessorKey: 'topReason', cell: ({ row }) => <span className="text-muted">{row.original.topReason ? humanize(row.original.topReason) : '—'}</span> },
];

export function AnalyticsScreen() {
  const [f, setF] = useUrlState({ from: daysAgo(29), to: isoDay(new Date()), granularity: 'day' });
  const range = { from: dayToIso(f.from, 'start'), to: dayToIso(f.to, 'end') };
  const [metric, setMetric] = React.useState<'revenue' | 'orders' | 'units' | 'aov'>('revenue');
  const sales = useApi<SalesAnalyticsDto>('/analytics/sales', { ...range, granularity: f.granularity });
  const products = useApi<ProductAnalyticsRow[]>('/analytics/products', range);
  const inventory = useApi<InventoryAnalyticsDto>('/analytics/inventory');
  const cancellations = useApi<CancellationReport>('/analytics/cancellations', range);
  const returns = useApi<ReturnsReport>('/analytics/returns', range);
  const cod = useApi<CodAnalyticsDto>('/analytics/cod', range);
  const returnRates = useApi<ProductReturnRateDto[]>('/analytics/return-rates', range);
  const sortedReturnRates = React.useMemo(() => returnRates.data && [...returnRates.data].sort((a, b) => b.returnRate - a.returnRate || b.unitsSold - a.unitsSold), [returnRates.data]);
  const highReturn = (returnRates.data ?? []).filter((r) => r.returnRate >= HIGH_RETURN_RATE).length;

  const series = (sales.data?.series ?? []).map((p) => ({ label: p.period, value: p[metric] }));
  const t = sales.data?.totals;
  const sortedProducts = React.useMemo(() => [...(products.data ?? [])].sort((a, b) => b.revenue - a.revenue), [products.data]);

  const exportReport = async (report: 'sales' | 'products' | 'inventory', format: 'csv' | 'xlsx') => {
    try {
      await downloadFile('/analytics/export', `vyra-${report}-${f.from}-${f.to}.${format}`, { query: { report, format, ...(report === 'inventory' ? {} : range) } });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Sales, product performance and stock valuation."
        actions={
          <Menu>
            <MenuTrigger asChild><Button variant="outline" size="sm"><Download /> Export</Button></MenuTrigger>
            <MenuContent className="w-52">
              {(['sales', 'products', 'inventory'] as const).map((r, i) => (
                <React.Fragment key={r}>
                  {i > 0 && <MenuSeparator />}
                  <MenuLabel>{humanize(r)} report</MenuLabel>
                  <MenuItem onSelect={() => void exportReport(r, 'csv')}>CSV</MenuItem>
                  <MenuItem onSelect={() => void exportReport(r, 'xlsx')}>Excel (XLSX)</MenuItem>
                </React.Fragment>
              ))}
            </MenuContent>
          </Menu>
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <Input type="date" aria-label="From" value={f.from} max={f.to} onChange={(e) => setF({ from: e.target.value })} className="h-9 w-40" />
          <span className="text-xs text-muted">to</span>
          <Input type="date" aria-label="To" value={f.to} min={f.from} onChange={(e) => setF({ to: e.target.value })} className="h-9 w-40" />
        </div>
        <div className="flex gap-1">
          {PRESETS.map((p) => (
            <Button key={p.label} variant="ghost" size="sm" onClick={() => setF({ from: daysAgo(p.days - 1), to: isoDay(new Date()), granularity: p.days > 90 ? 'month' : p.days > 31 ? 'week' : 'day' })}>{p.label}</Button>
          ))}
        </div>
        <Segmented size="sm" label="Granularity" value={f.granularity as Granularity} onChange={(granularity) => setF({ granularity })} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
      </div>

      {sales.error && !sales.data ? <ErrorState error={sales.error} onRetry={() => void sales.mutate()} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard loading={!t} label="Revenue" value={t ? formatINR(t.revenue) : ''} />
            <StatCard loading={!t} label="Orders" value={formatNumber(t?.orders)} />
            <StatCard loading={!t} label="Units sold" value={formatNumber(t?.units)} />
            <StatCard loading={!t} label="Average order value" value={t ? formatINR(t.aov) : ''} />
          </div>
          <Card className="mt-5">
            <CardHeader>
              <CardTitle>{metric === 'aov' ? 'Average order value' : humanize(metric)} by {f.granularity}</CardTitle>
              <Segmented size="sm" label="Metric" value={metric} onChange={setMetric} options={[{ value: 'revenue', label: 'Revenue' }, { value: 'orders', label: 'Orders' }, { value: 'units', label: 'Units' }, { value: 'aov', label: 'AOV' }]} />
            </CardHeader>
            <CardContent>
              {sales.isLoading && !sales.data ? <Skeleton className="h-[280px]" /> : series.length === 0 ? <EmptyState title="No sales in this period" className="py-16" /> : (
                <TimeSeriesChart data={series} kind={metric === 'revenue' || metric === 'aov' ? 'area' : 'bar'} money={metric === 'revenue' || metric === 'aov'} height={280} ariaLabel={`${metric} per ${f.granularity}`} />
              )}
            </CardContent>
          </Card>
        </>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <h2 className="mb-2 text-sm font-bold">Product performance</h2>
          <DataTable columns={productCols} data={sortedProducts} isLoading={products.isLoading} error={products.error} onRetry={() => void products.mutate()} getRowId={(r) => r.productId} dense empty={{ title: 'No product sales in this period' }} />
        </div>
        <Card>
          <CardHeader><CardTitle>Inventory valuation</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {inventory.error && !inventory.data ? <ErrorState error={inventory.error} /> : !inventory.data ? <Skeleton className="h-48" /> : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md border border-border p-3"><p className="text-xs text-muted">At cost</p><p className="tabular mt-1 font-semibold">{formatINR(inventory.data.valuationCost)}</p></div>
                  <div className="rounded-md border border-border p-3"><p className="text-xs text-muted">At retail</p><p className="tabular mt-1 font-semibold">{formatINR(inventory.data.valuationRetail)}</p></div>
                </div>
                {inventory.data.byCategory.length ? (
                  <BarList money items={inventory.data.byCategory.map((c) => ({ label: c.category, value: c.value, secondary: `${formatNumber(c.units)} u` }))} />
                ) : <p className="text-sm text-muted">No stock on hand.</p>}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <CancellationsCard state={cancellations} />
        <ReturnsCard state={returns} />
      </div>

      <section className="mt-5" aria-label="Cash on Delivery and RTO">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold">Cash on Delivery &amp; RTO</h2>
          <Link href="/cod" className="text-xs font-semibold text-muted hover:text-fg">Manage COD rules</Link>
        </div>
        {cod.error && !cod.data ? <ErrorState error={cod.error} onRetry={() => void cod.mutate()} /> : <CodKpis data={cod.data} />}
      </section>

      <section className="mt-5" aria-label="Return rates by product">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold">Return rates by product</h2>
          {highReturn > 0 && <Badge tone="danger">{formatNumber(highReturn)} product{highReturn === 1 ? '' : 's'} at {HIGH_RETURN_RATE}%+</Badge>}
        </div>
        <DataTable columns={returnRateCols} data={sortedReturnRates} isLoading={returnRates.isLoading} error={returnRates.error} onRetry={() => void returnRates.mutate()} getRowId={(r) => r.productId} dense empty={{ title: 'No delivered sales in this period' }} />
      </section>
    </>
  );
}

function CancellationsCard({ state }: { state: { data: CancellationReport | undefined; error: unknown; isLoading: boolean; mutate: () => unknown } }) {
  const d = state.data;
  return (
    <Card>
      <CardHeader><CardTitle>Cancellations</CardTitle>{d && <span className="tabular text-xs text-muted">{d.rate.toFixed(1)}% of orders</span>}</CardHeader>
      <CardContent>
        {state.error && !d ? <ErrorState error={state.error} onRetry={() => void state.mutate()} /> : !d ? <Skeleton className="h-32" /> : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Mini label="Orders" value={formatNumber(d.total)} />
              <Mini label="Cancelled" value={formatNumber(d.cancelled)} />
              <Mini label="Rate" value={`${d.rate.toFixed(1)}%`} />
            </div>
            {d.byReason.length ? <BarList items={d.byReason.map((r) => ({ label: r.reason, value: r.count, secondary: formatINR(r.value) }))} /> : <p className="text-sm text-muted">No cancellations in this period.</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReturnsCard({ state }: { state: { data: ReturnsReport | undefined; error: unknown; isLoading: boolean; mutate: () => unknown } }) {
  const d = state.data;
  const byReason = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const r of d?.byReason ?? []) m.set(r.reason, (m.get(r.reason) ?? 0) + r.count);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [d]);
  return (
    <Card>
      <CardHeader><CardTitle>Returns</CardTitle></CardHeader>
      <CardContent>
        {state.error && !d ? <ErrorState error={state.error} onRetry={() => void state.mutate()} /> : !d ? <Skeleton className="h-32" /> : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Mini label="Return requests" value={formatNumber(d.requests)} />
              <Mini label="Refunded" value={formatINR(d.refunded)} />
            </div>
            {byReason.length ? <BarList items={byReason.map(([reason, count]) => ({ label: humanize(reason), value: count }))} /> : <p className="text-sm text-muted">No returns in this period.</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-border p-3"><p className="text-xs text-muted">{label}</p><p className="tabular mt-1 font-semibold">{value}</p></div>;
}
