'use client';
import * as React from 'react';
import Link from 'next/link';
import type { CampaignReportDto } from '@vyra/shared';
import { Card, CardContent, CardHeader, CardTitle, EmptyState, Skeleton, cn } from '@vyra/ui';
import { BarChart3, IndianRupee, Package, ShoppingBag, Users } from 'lucide-react';
import { useApi } from '@/lib/swr';
import { formatINR, formatNumber } from '@/lib/format';
import { ErrorState, StatCard } from '@/components/ui/feedback';
import { BarList, TimeSeriesChart } from '@/features/charts/time-series-chart';

const tableCls = 'w-full border-collapse text-sm';
const thCls = 'whitespace-nowrap px-3 py-2 text-xs font-medium text-muted first:pl-4 last:pr-4';
const tdCls = 'px-3 py-2 first:pl-4 last:pr-4';

export function ReportTab({ campaignId }: { campaignId: string }) {
  const { data: r, error, isLoading, mutate } = useApi<CampaignReportDto>(`/campaigns/${campaignId}/report`);
  if (error && !r) return <ErrorState error={error} onRetry={() => void mutate()} />;
  if (isLoading || !r) return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}<Skeleton className="h-64 sm:col-span-2 lg:col-span-4" /></div>;

  const discounts = [
    { label: 'Sale prices', value: r.discount.campaign },
    { label: 'Bundle offers', value: r.discount.promotion },
    { label: 'Coupons', value: r.discount.coupon },
    { label: 'Prepaid', value: r.discount.prepaid },
  ];
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Orders" value={formatNumber(r.orders)} icon={<ShoppingBag />} hint={r.cancelledOrders ? `${formatNumber(r.cancelledOrders)} cancelled (excluded)` : undefined} />
        <StatCard label="Units sold" value={formatNumber(r.units)} icon={<Package />} hint={r.returnedUnits ? `${formatNumber(r.returnedUnits)} returned` : undefined} />
        <StatCard label="Revenue (deal items)" value={formatINR(r.revenue)} icon={<IndianRupee />} hint={`AOV ${formatINR(r.aov)}`} />
        <StatCard label="Subscribers" value={formatNumber(r.subscribers)} icon={<Users />} hint="Asked to be reminded" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Discount given</CardTitle><span className="tabular text-sm font-semibold">{formatINR(r.discount.total)}</span></CardHeader>
          <CardContent className="space-y-4">
            <BarList items={discounts} money />
            {r.budget != null ? (
              <div>
                <div className="flex justify-between text-xs"><span className="text-muted">Budget used (excl. prepaid)</span><span className="tabular font-semibold">{r.budgetUsedPercent ?? 0}% of {formatINR(r.budget)}</span></div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Budget used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, r.budgetUsedPercent ?? 0)}>
                  <div className={cn('h-full rounded-full', (r.budgetUsedPercent ?? 0) >= 100 ? 'bg-danger' : (r.budgetUsedPercent ?? 0) >= 80 ? 'bg-amber-500' : 'bg-violet-500')} style={{ width: `${Math.min(100, r.budgetUsedPercent ?? 0)}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted">The campaign pauses itself at 100%.</p>
              </div>
            ) : <p className="text-xs text-muted">No discount budget set.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Revenue by day (IST)</CardTitle></CardHeader>
          <CardContent>
            {r.daily.length ? <TimeSeriesChart kind="area" money height={220} ariaLabel="Campaign revenue by day" data={r.daily.map((d) => ({ label: d.date.slice(5), value: d.revenue }))} />
              : <EmptyState icon={<BarChart3 />} title="No orders yet" className="py-10" />}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader><CardTitle>Top products</CardTitle></CardHeader>
          {r.topProducts.length ? (
            <div className="overflow-x-auto">
              <table className={tableCls}>
                <thead><tr className="border-b border-border bg-surface text-left"><th scope="col" className={thCls}>Product</th><th scope="col" className={cn(thCls, 'text-right')}>Units</th><th scope="col" className={cn(thCls, 'text-right')}>Revenue</th></tr></thead>
                <tbody>{r.topProducts.map((p) => (
                  <tr key={p.productId} className="border-b border-border last:border-0">
                    <td className={tdCls}><Link href={`/products/${p.productId}`} className="font-medium hover:underline">{p.name}</Link></td>
                    <td className={cn(tdCls, 'tabular text-right')}>{formatNumber(p.units)}</td>
                    <td className={cn(tdCls, 'tabular text-right')}>{formatINR(p.revenue)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="px-4 py-8 text-center text-sm text-muted">No sales yet.</p>}
        </Card>
        <Card className="overflow-hidden">
          <CardHeader><CardTitle>Sell-through</CardTitle><span className="text-xs text-muted">Top 50 deals by units sold</span></CardHeader>
          {r.sellThrough.length ? (
            <div className="relative max-h-96 overflow-auto">
              <table className={tableCls}>
                <thead className="sticky top-0"><tr className="border-b border-border bg-surface text-left"><th scope="col" className={thCls}>Variant</th><th scope="col" className={cn(thCls, 'text-right')}>Sold / cap</th><th scope="col" className={thCls}><span className="sr-only">Progress</span></th></tr></thead>
                <tbody>{r.sellThrough.map((s) => {
                  const pct = s.stockCap ? Math.min(100, (s.soldCount / s.stockCap) * 100) : null;
                  return (
                    <tr key={s.variantId} className="border-b border-border last:border-0">
                      <td className={tdCls}><span className="block max-w-56 truncate">{s.productName}</span><span className="block font-mono text-xs text-muted">{s.sku}</span></td>
                      <td className={cn(tdCls, 'tabular whitespace-nowrap text-right')}>{formatNumber(s.soldCount)} / {s.stockCap != null ? formatNumber(s.stockCap) : 'no cap'}</td>
                      <td className={cn(tdCls, 'w-28')}>
                        {pct != null && <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label={`${s.sku} sell-through`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}><div className={cn('h-full rounded-full', pct >= 100 ? 'bg-danger' : 'bg-teal-500')} style={{ width: `${pct}%` }} /></div>}
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          ) : <p className="px-4 py-8 text-center text-sm text-muted">No deals.</p>}
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader><CardTitle>Daily</CardTitle></CardHeader>
        {r.daily.length ? (
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead><tr className="border-b border-border bg-surface text-left"><th scope="col" className={thCls}>Date (IST)</th><th scope="col" className={cn(thCls, 'text-right')}>Orders</th><th scope="col" className={cn(thCls, 'text-right')}>Revenue</th><th scope="col" className={cn(thCls, 'text-right')}>Discount</th></tr></thead>
              <tbody>{r.daily.map((d) => (
                <tr key={d.date} className="border-b border-border last:border-0">
                  <td className={cn(tdCls, 'tabular')}>{d.date}</td>
                  <td className={cn(tdCls, 'tabular text-right')}>{formatNumber(d.orders)}</td>
                  <td className={cn(tdCls, 'tabular text-right')}>{formatINR(d.revenue)}</td>
                  <td className={cn(tdCls, 'tabular text-right')}>{formatINR(d.discount)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="px-4 py-8 text-center text-sm text-muted">No orders in this campaign yet.</p>}
      </Card>
    </div>
  );
}
