'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import type { DashboardDto, OrderSummaryDto } from '@vyra/shared';
import { Card, CardContent, CardHeader, CardTitle, EmptyState, Skeleton } from '@vyra/ui';
import { IndianRupee, ShoppingBag, Users, Shirt, Boxes, AlertTriangle, PackageX, Wallet, CalendarClock, Clock, ArrowRight } from 'lucide-react';
import { useApi } from '@/lib/swr';
import { useAuth } from '@/features/auth/auth-context';
import { PERM } from '@/lib/permissions';
import { formatDate, formatDateTime, formatINR, formatNumber } from '@/lib/format';
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE } from '@/lib/status';
import { ErrorState, PageHeader, StatCard, StatusBadge } from '@/components/ui/feedback';
import { Segmented } from '@/components/ui/controls';
import { DataTable } from '@/components/data-table/data-table';
import { TimeSeriesChart, BarList } from '@/features/charts/time-series-chart';
import { NAV, isNavVisible } from '@/components/layout/nav';

export function DashboardScreen() {
  const { can, user } = useAuth();
  const router = useRouter();
  const allowed = can(PERM.analyticsRead);
  // Roles without analytics land on their primary workspace.
  const landing = !allowed ? (can(PERM.inventoryRead) ? '/inventory' : can(PERM.ordersRead) ? '/orders' : null) : null;
  React.useEffect(() => { if (landing) router.replace(landing); }, [landing, router]);
  if (landing) return null;
  if (!allowed) return <Welcome name={user.name} />;
  return <Dashboard />;
}

function Welcome({ name }: { name: string }) {
  const { can } = useAuth();
  const links = NAV.flatMap((g) => g.items).filter((i) => i.href !== '/' && isNavVisible(i, can));
  return (
    <>
      <PageHeader title={`Welcome, ${name.split(' ')[0]}`} description="Jump into your work." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="group flex items-center gap-3 rounded-lg border border-border bg-bg p-4 hover:border-border-strong">
            <l.icon className="size-5 text-subtle" aria-hidden />
            <span className="flex-1 text-sm font-semibold">{l.label}</span>
            <ArrowRight className="size-4 text-subtle transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        ))}
      </div>
    </>
  );
}

const recentColumns: ColumnDef<OrderSummaryDto, unknown>[] = [
  { header: 'Order', accessorKey: 'number', cell: ({ row }) => <span className="font-medium">{row.original.number}</span> },
  { header: 'Customer', accessorKey: 'customerName', cell: ({ row }) => <span className="block max-w-48 truncate">{row.original.customerName}</span> },
  { header: 'Status', accessorKey: 'status', cell: ({ row }) => <StatusBadge value={row.original.status} tone={ORDER_STATUS_TONE[row.original.status]} label={ORDER_STATUS_LABEL[row.original.status]} /> },
  { header: 'Placed', accessorKey: 'createdAt', cell: ({ row }) => <span className="text-muted">{formatDateTime(row.original.createdAt)}</span> },
  { header: 'Total', accessorKey: 'grandTotal', meta: { align: 'right' }, cell: ({ row }) => formatINR(row.original.grandTotal) },
];

function Dashboard() {
  const router = useRouter();
  const { data, error, isLoading, mutate } = useApi<DashboardDto>('/dashboard', undefined, { refreshInterval: 60_000 });
  const [metric, setMetric] = React.useState<'revenue' | 'orders'>('revenue');
  const loading = isLoading && !data;

  const series = React.useMemo(
    () => (data?.revenueSeries ?? []).map((p) => ({ label: formatDate(p.date).replace(/ \d{4}$/, ''), value: metric === 'revenue' ? p.revenue : p.orders })),
    [data, metric],
  );

  if (error && !data) return (<><PageHeader title="Dashboard" /><ErrorState error={error} onRetry={() => void mutate()} /></>);

  const inv = data?.inventory;
  const available = inv ? Math.max(0, inv.totalUnits - inv.reservedUnits) : 0;

  return (
    <>
      <PageHeader title="Dashboard" description="Store performance and stock health at a glance." />
      <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard loading={loading} label="Total revenue" icon={<IndianRupee />} value={data ? formatINR(data.revenue.total) : ''} hint={data ? `${formatINR(data.revenue.last30Days)} last 30 days` : undefined} />
        <StatCard loading={loading} label="Today's sales" icon={<CalendarClock />} value={data ? formatINR(data.revenue.today) : ''} hint={data ? `${formatNumber(data.orders.today)} orders today` : undefined} />
        <StatCard loading={loading} label="Total orders" icon={<ShoppingBag />} value={data ? formatNumber(data.orders.total) : ''} />
        <StatCard loading={loading} label="Pending orders" icon={<Clock />} value={data ? formatNumber(data.orders.pending) : ''} tone={data && data.orders.pending > 0 ? 'warning' : 'default'} />
        <StatCard loading={loading} label="Customers" icon={<Users />} value={data ? formatNumber(data.customers.total) : ''} hint={data ? `+${formatNumber(data.customers.newLast30Days)} last 30 days` : undefined} />
        <StatCard loading={loading} label="Products" icon={<Shirt />} value={data ? formatNumber(data.catalog.products) : ''} hint={data ? `${formatNumber(data.catalog.activeProducts)} active · ${formatNumber(data.catalog.variants)} variants` : undefined} />
        <StatCard loading={loading} label="Units in stock" icon={<Boxes />} value={data ? formatNumber(data.inventory.totalUnits) : ''} hint={data ? `${formatNumber(data.inventory.reservedUnits)} reserved` : undefined} />
        <StatCard loading={loading} label="Low stock" icon={<AlertTriangle />} value={data ? formatNumber(data.inventory.lowStock) : ''} tone={data && data.inventory.lowStock > 0 ? 'warning' : 'default'} hint="variants at/below threshold" />
        <StatCard loading={loading} label="Out of stock" icon={<PackageX />} value={data ? formatNumber(data.inventory.outOfStock) : ''} tone={data && data.inventory.outOfStock > 0 ? 'danger' : 'default'} hint="variants" />
        <StatCard loading={loading} label="Inventory valuation" icon={<Wallet />} value={data ? formatINR(data.inventory.valuation) : ''} hint="at cost" />
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>{metric === 'revenue' ? 'Revenue' : 'Orders'} by day</CardTitle>
            <Segmented size="sm" label="Chart metric" value={metric} onChange={setMetric} options={[{ value: 'revenue', label: 'Revenue' }, { value: 'orders', label: 'Orders' }]} />
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-[260px] w-full" /> : series.length === 0 ? (
              <EmptyState title="No sales yet" description="Revenue will appear here once orders come in." className="py-16" />
            ) : (
              <TimeSeriesChart data={series} kind={metric === 'revenue' ? 'area' : 'bar'} money={metric === 'revenue'} ariaLabel={`${metric} per day`} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Inventory overview</CardTitle><Link href="/inventory" className="text-xs font-semibold text-muted hover:text-fg">View stock</Link></CardHeader>
          <CardContent className="space-y-5">
            {loading || !inv ? <Skeleton className="h-40 w-full" /> : (
              <>
                <div>
                  <div className="flex items-baseline justify-between"><span className="text-sm text-muted">Units on hand</span><span className="tabular text-lg font-semibold">{formatNumber(inv.totalUnits)}</span></div>
                  <div className="mt-2 flex h-2 gap-0.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                    <div className="bg-violet-500" style={{ width: `${inv.totalUnits ? (available / inv.totalUnits) * 100 : 0}%` }} />
                    <div className="bg-sun-400" style={{ width: `${inv.totalUnits ? (inv.reservedUnits / inv.totalUnits) * 100 : 0}%` }} />
                  </div>
                  <div className="mt-2 flex gap-4 text-xs text-muted">
                    <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-violet-500" />Available {formatNumber(available)}</span>
                    <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-sun-400" />Reserved {formatNumber(inv.reservedUnits)}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Link href="/inventory?status=LOW_STOCK" className="rounded-md border border-border p-3 hover:border-border-strong">
                    <p className="text-xs text-muted">Low stock</p><p className="tabular mt-1 text-lg font-semibold text-warning">{formatNumber(inv.lowStock)}</p>
                  </Link>
                  <Link href="/inventory?status=OUT_OF_STOCK" className="rounded-md border border-border p-3 hover:border-border-strong">
                    <p className="text-xs text-muted">Out of stock</p><p className="tabular mt-1 text-lg font-semibold text-danger">{formatNumber(inv.outOfStock)}</p>
                  </Link>
                </div>
                <div className="flex items-baseline justify-between border-t border-border pt-3 text-sm"><span className="text-muted">Valuation (cost)</span><span className="tabular font-semibold">{formatINR(inv.valuation)}</span></div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Best sellers</CardTitle><span className="text-xs text-muted">by units</span></CardHeader>
          <CardContent className="p-0">
            {loading ? <div className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div> : !data?.bestSellers.length ? (
              <EmptyState title="No best sellers yet" className="py-12" />
            ) : (
              <ul className="divide-y divide-border">
                {data.bestSellers.map((b, i) => (
                  <li key={b.productId}>
                    <Link href={`/products/${b.productId}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-surface">
                      <span className="tabular w-4 text-xs text-subtle">{i + 1}</span>
                      <span className="size-10 shrink-0 overflow-hidden rounded-md bg-surface-2">
                        {b.imageUrl && <img src={b.imageUrl} alt="" className="size-full object-cover" loading="lazy" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{b.name}</span>
                      <span className="tabular text-right text-sm"><span className="block font-medium">{formatNumber(b.units)} units</span><span className="block text-xs text-muted">{formatINR(b.revenue)}</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Category performance</CardTitle><span className="text-xs text-muted">revenue</span></CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-48" /> : !data?.categoryPerformance.length ? (
              <EmptyState title="No category sales yet" className="py-12" />
            ) : (
              <BarList money items={data.categoryPerformance.map((c) => ({ label: c.category, value: c.revenue, secondary: `${formatNumber(c.units)} units` }))} />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-bold">Recent orders</h2>
          <Link href="/orders" className="text-xs font-semibold text-muted hover:text-fg">All orders</Link>
        </div>
        <DataTable
          columns={recentColumns}
          data={data?.recentOrders}
          isLoading={loading}
          getRowId={(o) => o.id}
          onRowClick={(o) => router.push(`/orders/${o.id}`)}
          empty={{ title: 'No orders yet' }}
        />
      </div>
    </>
  );
}
