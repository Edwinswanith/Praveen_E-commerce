'use client';
import * as React from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import type { FunnelDto } from '@vyra/shared';
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, Skeleton, cn } from '@vyra/ui';
import { ArrowDown, Camera, MousePointerClick, ShoppingBag, ShoppingCart, Sparkles, Activity, TrendingDown } from 'lucide-react';
import { useApi } from '@/lib/swr';
import { useUrlState } from '@/hooks/use-url-state';
import { dayToIso, daysAgo, formatDate, formatINR, formatNumber, isoDay } from '@/lib/format';
import { DataTable } from '@/components/data-table/data-table';
import { ErrorState, PageHeader, StatCard } from '@/components/ui/feedback';
import { MultiLineChart } from '@/features/charts/time-series-chart';
import { DateRangeControl } from './date-range';
import {
  LOW_INTEREST_MAX_RATE, LOW_INTEREST_MIN_VIEWS, QUOTA_WARN_PCT, STEP_LABEL,
  biggestLeak, deviceLabel, dropOffs, hasNoEvents, isLowInterest, leakMessage, quotaUsage, sourceLabel, tryOnUplift,
  type FunnelProduct,
} from './funnel';

const pct = (n: number) => `${n.toFixed(1)}%`;
const SESSIONS_COLOR = '#7c3aed'; // violet-500
const ORDERS_COLOR = '#16a085'; // teal-500

type DeviceRow = FunnelDto['byDevice'][number];
type SourceRow = FunnelDto['bySource'][number];

const deviceCols: ColumnDef<DeviceRow, unknown>[] = [
  { header: 'Device', accessorKey: 'device', cell: ({ row }) => <span className="font-medium">{deviceLabel(row.original.device)}</span> },
  { header: 'Sessions', accessorKey: 'sessions', meta: { align: 'right' }, cell: ({ row }) => formatNumber(row.original.sessions) },
  { header: 'Orders', accessorKey: 'orders', meta: { align: 'right' }, cell: ({ row }) => formatNumber(row.original.orders) },
  { header: 'Conversion', accessorKey: 'conversionRate', meta: { align: 'right' }, cell: ({ row }) => pct(row.original.conversionRate) },
];

const sourceCols: ColumnDef<SourceRow, unknown>[] = [
  { header: 'Source', accessorKey: 'source', cell: ({ row }) => <span className="font-medium">{sourceLabel(row.original.source)}</span> },
  { header: 'Sessions', accessorKey: 'sessions', meta: { align: 'right' }, cell: ({ row }) => formatNumber(row.original.sessions) },
  { header: 'Orders', accessorKey: 'orders', meta: { align: 'right' }, cell: ({ row }) => formatNumber(row.original.orders) },
  { header: 'Conversion', accessorKey: 'conversionRate', meta: { align: 'right' }, cell: ({ row }) => pct(row.original.conversionRate) },
  { header: 'Revenue', accessorKey: 'revenue', meta: { align: 'right' }, cell: ({ row }) => formatINR(row.original.revenue) },
];

const productCols: ColumnDef<FunnelProduct, unknown>[] = [
  {
    header: 'Product', accessorKey: 'name',
    cell: ({ row: { original: p } }) => (
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/products/${p.productId}`} className="font-medium hover:underline">{p.name}</Link>
        {isLowInterest(p) && <Badge tone="warning" title={`${LOW_INTEREST_MIN_VIEWS}+ views but under ${LOW_INTEREST_MAX_RATE}% add to bag`}>Low interest: check photos/price</Badge>}
      </div>
    ),
  },
  { header: 'Views', accessorKey: 'views', meta: { align: 'right' }, cell: ({ row }) => formatNumber(row.original.views) },
  { header: 'Added to bag', accessorKey: 'addToCart', meta: { align: 'right' }, cell: ({ row }) => formatNumber(row.original.addToCart) },
  {
    header: 'View → bag', accessorKey: 'viewToCartRate', meta: { align: 'right' },
    cell: ({ row: { original: p } }) => <span className={isLowInterest(p) ? 'font-semibold text-warning' : undefined}>{pct(p.viewToCartRate)}</span>,
  },
  { header: 'Try-ons', accessorKey: 'tryOns', meta: { align: 'right' }, cell: ({ row }) => <span className={row.original.tryOns ? undefined : 'text-muted'}>{formatNumber(row.original.tryOns)}</span> },
];

export function ConversionScreen() {
  const [f, setF] = useUrlState({ from: daysAgo(29), to: isoDay(new Date()) });
  const range = { from: dayToIso(f.from, 'start'), to: dayToIso(f.to, 'end') };
  const { data, error, isLoading, mutate } = useApi<FunnelDto>('/analytics/funnel', range);

  return (
    <>
      <PageHeader
        title="Conversion"
        description={<>How shoppers move from viewing a product to ordering (unique sessions). Sales figures are in <Link href={`/analytics?from=${f.from}&to=${f.to}`} className="font-semibold text-fg underline-offset-2 hover:underline">Analytics</Link>.</>}
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <DateRangeControl from={f.from} to={f.to} onChange={setF} />
      </div>
      {error && !data ? <ErrorState error={error} onRetry={() => void mutate()} /> : isLoading && !data ? <LoadingState /> : data ? (
        hasNoEvents(data) ? <NoEvents tryOn={data.tryOn} /> : <ConversionBody data={data} />
      ) : null}
    </>
  );
}

function LoadingState() {
  return (
    <div className="space-y-5" aria-busy="true">
      <Skeleton className="h-64" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-24" />)}</div>
    </div>
  );
}

export function NoEvents({ tryOn }: { tryOn: FunnelDto['tryOn'] }) {
  return (
    <Card>
      <EmptyState
        icon={<Activity />}
        title="No shopper activity recorded yet"
        description="Conversion tracking started with this release. As shoppers browse the storefront — viewing products, adding to bag, checking out and using virtual try-on — their anonymous sessions appear here within minutes. No personal data is collected."
        action={
          <div className="flex flex-col items-center gap-2 text-xs text-muted">
            <span>Try a wider date range if you expected data for this period.</span>
            <span>Virtual try-on daily limit: {formatNumber(tryOn.dailyLimit)} · used today: {formatNumber(tryOn.usedToday)}</span>
          </div>
        }
      />
    </Card>
  );
}

function ConversionBody({ data }: { data: FunnelDto }) {
  const leak = biggestLeak(data.steps);
  const uplift = tryOnUplift(data.tryOn, data.conversionRate);
  const quota = quotaUsage(data.tryOn.usedToday, data.tryOn.dailyLimit);
  const lowInterest = data.products.filter(isLowInterest).length;
  const daily = data.daily.map((d) => ({ label: formatDate(`${d.date}T00:00:00`).replace(/ \d{4}$/, ''), sessions: d.sessions, orders: d.orders }));

  return (
    <>
      <Card>
        <CardHeader><CardTitle>Funnel</CardTitle><span className="text-xs text-muted">unique sessions</span></CardHeader>
        <CardContent className="space-y-4">
          {leak && (
            <Alert tone="warning">
              <span className="flex items-start gap-2"><TrendingDown className="mt-0.5 size-4 shrink-0" aria-hidden /><span><strong>{leakMessage(leak)}</strong> ({formatNumber(leak.lost)} sessions).</span></span>
            </Alert>
          )}
          <FunnelSteps steps={data.steps} />
        </CardContent>
      </Card>

      <section aria-label="Conversion KPIs" className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Conversion rate" icon={<ShoppingBag />} value={pct(data.conversionRate)} hint="ordered ÷ viewed a product" />
        <StatCard label="Bag abandonment" icon={<ShoppingCart />} value={pct(data.bagAbandonmentRate)} hint="added to bag, no checkout" tone={data.bagAbandonmentRate >= 70 ? 'warning' : 'default'} />
        <StatCard label="Checkout abandonment" icon={<MousePointerClick />} value={pct(data.checkoutAbandonmentRate)} hint="started checkout, no order" tone={data.checkoutAbandonmentRate >= 50 ? 'warning' : 'default'} />
        <StatCard label="Try-on sessions" icon={<Camera />} value={formatNumber(data.tryOn.sessions)} hint={`${formatNumber(data.tryOn.total)} try-ons in total`} />
        <StatCard
          label="Try-on → order"
          icon={<Sparkles />}
          value={uplift ? pct(data.tryOn.conversionRate) : '—'}
          hint={!uplift ? 'No try-ons in this period' : (
            <>vs {pct(data.conversionRate)} overall{uplift.points > 0 && <span className="ml-1 font-semibold text-success">+{uplift.points.toFixed(1)} pts{uplift.ratio && uplift.ratio >= 1.1 ? ` (${uplift.ratio}×)` : ''}</span>}{uplift.points < 0 && <span className="ml-1 font-semibold text-danger">{uplift.points.toFixed(1)} pts</span>}</>
          )}
        />
        <StatCard
          label="Try-ons used today"
          icon={<Camera />}
          value={`${formatNumber(data.tryOn.usedToday)} / ${formatNumber(data.tryOn.dailyLimit)}`}
          tone={quota.warn ? (quota.pct >= 100 ? 'danger' : 'warning') : 'default'}
          hint={quota.warn ? `${quota.pct}% of daily limit — new try-ons stop at 100%` : `${quota.pct}% of daily limit (warns at ${QUOTA_WARN_PCT}%)`}
        />
      </section>

      <Card className="mt-5">
        <CardHeader><CardTitle>Daily sessions vs orders</CardTitle></CardHeader>
        <CardContent>
          {daily.length === 0 ? <EmptyState title="No sessions in this period" className="py-12" /> : (
            <MultiLineChart
              data={daily}
              series={[{ key: 'sessions', label: 'Sessions', color: SESSIONS_COLOR }, { key: 'orders', label: 'Orders', color: ORDERS_COLOR }]}
              ariaLabel="Sessions and orders per day"
            />
          )}
        </CardContent>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section aria-label="By device" className="min-w-0">
          <h2 className="mb-2 text-sm font-bold">By device</h2>
          <DataTable columns={deviceCols} data={data.byDevice} getRowId={(r) => r.device} dense empty={{ title: 'No device data' }} />
        </section>
        <section aria-label="By source" className="min-w-0">
          <h2 className="mb-2 text-sm font-bold">By source <span className="font-normal text-muted">(first touch)</span></h2>
          <DataTable columns={sourceCols} data={data.bySource} getRowId={(r) => r.source} dense empty={{ title: 'No source data' }} />
        </section>
      </div>

      <section className="mt-5" aria-label="Product interest">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold">Product interest</h2>
          {lowInterest > 0 && <Badge tone="warning">{formatNumber(lowInterest)} low-interest product{lowInterest === 1 ? '' : 's'}</Badge>}
        </div>
        <DataTable columns={productCols} data={data.products} getRowId={(r) => r.productId} dense empty={{ title: 'No product views in this period' }} />
        <p className="mt-2 text-xs text-muted">Flagged when a product has {LOW_INTEREST_MIN_VIEWS}+ viewing sessions but fewer than {LOW_INTEREST_MAX_RATE}% add it to bag.</p>
      </section>
    </>
  );
}

/** Four horizontal CSS bars (width ∝ sessions) with the drop-off between each pair; the biggest leak is highlighted. */
export function FunnelSteps({ steps }: { steps: FunnelDto['steps'] }) {
  const max = Math.max(1, ...steps.map((s) => s.sessions));
  const drops = dropOffs(steps);
  const leak = biggestLeak(steps);
  return (
    <ol className="space-y-1" aria-label="Conversion funnel">
      {steps.map((s, i) => {
        const drop = i > 0 ? drops[i - 1] : undefined;
        const isLeak = !!drop && !!leak && drop.to === leak.to;
        return (
          <li key={s.step}>
            {drop && (
              <div className={cn('flex items-center gap-2 py-1 pl-1 text-xs', isLeak ? 'font-semibold text-danger' : 'text-muted')} data-leak={isLeak || undefined}>
                <ArrowDown className="size-3.5" aria-hidden />
                <span className="tabular">{drop.lost > 0 ? `${pct(drop.dropPct)} drop-off · ${formatNumber(drop.lost)} sessions lost` : 'No drop-off'}</span>
                {isLeak && <Badge tone="danger">Biggest leak</Badge>}
              </div>
            )}
            <div className="grid grid-cols-[8.5rem_1fr] items-center gap-3 sm:grid-cols-[10rem_1fr_9rem]">
              <span className="text-sm font-medium">{STEP_LABEL[s.step]}</span>
              <div className="h-7 rounded-md bg-surface-2">
                <div className="h-full rounded-md bg-violet-500" style={{ width: `${Math.max(s.sessions ? 2 : 0, (s.sessions / max) * 100)}%`, opacity: 1 - i * 0.15 }} />
              </div>
              <span className="tabular col-start-2 text-sm sm:col-start-auto sm:text-right">
                <span className="font-semibold">{formatNumber(s.sessions)}</span>
                <span className="ml-2 text-xs text-muted">{i === 0 ? '100%' : !steps[i - 1]!.sessions || s.rateFromPrevious === null ? '— of previous' : `${pct(s.rateFromPrevious)} of previous`}</span>
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
