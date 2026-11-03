'use client';
import * as React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import type { CodAnalyticsDto, CodRiskDto, CodSettingsDto } from '@vyra/shared';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@vyra/ui';
import { MapPinOff, ShieldBan, Trash2 } from 'lucide-react';
import { useApi } from '@/lib/swr';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-context';
import { PERM } from '@/lib/permissions';
import { useUrlState } from '@/hooks/use-url-state';
import { dayToIso, daysAgo, formatDate, formatDateTime, formatINR, formatNumber, isoDay } from '@/lib/format';
import { DataTable } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import { SearchInput } from '@/components/data-table/search-input';
import { ErrorState, KeyValue, PageHeader } from '@/components/ui/feedback';
import { Segmented } from '@/components/ui/controls';
import { useConfirm } from '@/components/ui/confirm';
import { BlockedPincodeForm } from './blocked-pincode-form';
import { CodBlockButton } from './cod-block';
import { CodKpis } from './cod-kpis';

type Blocked = { pincode: string; reason: string | null; createdAt: string };
const PERIODS = [{ value: '30', label: '30d' }, { value: '90', label: '90d' }, { value: '365', label: '12m' }] as const;
type Period = (typeof PERIODS)[number]['value'];

export function CodScreen() {
  const { can } = useAuth();
  const canWrite = can(PERM.ordersWrite);
  const canAnalytics = can(PERM.analyticsRead);
  const confirm = useConfirm();
  const settings = useApi<CodSettingsDto>('/cod/settings');
  const [f, setF] = useUrlState({ q: '', blocked: 'all', page: '1', period: '90' });
  const risks = useApi<CodRiskDto[]>('/cod/risks', { q: f.q.replace(/\D/g, ''), blocked: f.blocked === 'all' ? undefined : f.blocked, page: f.page, pageSize: 20 });
  const days = Number(f.period) || 90;
  const analytics = useApi<CodAnalyticsDto>(canAnalytics ? '/analytics/cod' : null, { from: dayToIso(daysAgo(days - 1), 'start'), to: dayToIso(isoDay(new Date()), 'end') });
  const s = settings.data;
  const blockedSet = React.useMemo(() => new Set((s?.blockedPincodes ?? []).map((b) => b.pincode)), [s]);
  const [blockingPin, setBlockingPin] = React.useState<string | null>(null);

  const setSettings = (next: CodSettingsDto) => void settings.mutate({ data: next, extra: {} }, { revalidate: false });

  const unblockPin = async (pincode: string) => {
    if (!(await confirm({ title: `Allow COD for PIN ${pincode}?`, description: 'Customers delivering to this PIN code will see Cash on Delivery again.', confirmLabel: 'Remove block' }))) return;
    try {
      setSettings(await api.delete<CodSettingsDto>(`/cod/blocked-pincodes/${pincode}`));
      toast.success(`PIN ${pincode} unblocked`);
    } catch (err) { toast.error(errorMessage(err)); }
  };

  const blockTopPin = async (p: CodAnalyticsDto['topRtoPincodes'][number]) => {
    if (!(await confirm({ title: `Block COD for PIN ${p.pincode}?`, description: `${formatNumber(p.rto)} of ${formatNumber(p.orders)} orders to this PIN came back RTO. Customers there will have to pay online.`, confirmLabel: 'Block COD', destructive: true }))) return;
    setBlockingPin(p.pincode);
    try {
      setSettings(await api.post<CodSettingsDto>('/cod/blocked-pincodes', { pincode: p.pincode, reason: `High RTO: ${p.rto} of ${p.orders} orders` }));
      toast.success(`COD blocked for PIN ${p.pincode}`);
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBlockingPin(null); }
  };

  const pinCols = React.useMemo<ColumnDef<Blocked, unknown>[]>(() => [
    { header: 'PIN code', accessorKey: 'pincode', cell: ({ row }) => <span className="font-mono font-medium">{row.original.pincode}</span> },
    { header: 'Reason', accessorKey: 'reason', cell: ({ row }) => <span className="text-muted">{row.original.reason ?? '—'}</span> },
    { header: 'Blocked', accessorKey: 'createdAt', cell: ({ row }) => <span className="whitespace-nowrap text-muted">{formatDate(row.original.createdAt)}</span> },
    ...(canWrite ? [{
      id: 'actions', header: '', meta: { align: 'right' },
      cell: ({ row }) => <Button size="sm" variant="ghost" aria-label={`Remove block for ${row.original.pincode}`} onClick={() => void unblockPin(row.original.pincode)}><Trash2 /> Remove</Button>,
    } satisfies ColumnDef<Blocked, unknown>] : []),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [canWrite]);

  const riskCols = React.useMemo<ColumnDef<CodRiskDto, unknown>[]>(() => [
    { header: 'Phone', accessorKey: 'phone', cell: ({ row }) => <Link href={`/orders?q=${row.original.phone}`} className="font-mono font-medium hover:underline">{row.original.phone}</Link> },
    { header: 'RTO parcels', accessorKey: 'rtoCount', meta: { align: 'right' }, cell: ({ row }) => <span className={row.original.rtoCount >= (s?.rtoBlockThreshold ?? Infinity) ? 'font-semibold text-danger' : undefined}>{formatNumber(row.original.rtoCount)}</span> },
    { header: 'Last RTO', accessorKey: 'lastRtoAt', cell: ({ row }) => <span className="whitespace-nowrap text-muted">{formatDateTime(row.original.lastRtoAt)}</span> },
    { header: 'COD', accessorKey: 'codBlocked', cell: ({ row }) => row.original.codBlocked ? <Badge tone="danger">Blocked</Badge> : <Badge tone="success">Allowed</Badge> },
    { header: 'Note', accessorKey: 'note', cell: ({ row }) => <span className="block max-w-64 truncate text-xs text-muted">{row.original.note ?? '—'}</span> },
    ...(canWrite ? [{
      id: 'actions', header: '', meta: { align: 'right' },
      cell: ({ row }) => <CodBlockButton phone={row.original.phone} blocked={row.original.codBlocked} onDone={() => void risks.mutate()} />,
    } satisfies ColumnDef<CodRiskDto, unknown>] : []),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [canWrite, s?.rtoBlockThreshold]);

  return (
    <>
      <PageHeader title="COD & RTO" description="Cash on Delivery rules, refused-parcel (RTO) history and blocked PIN codes." />

      {settings.error && !s ? <ErrorState error={settings.error} onRetry={() => void settings.mutate()} className="mb-5" /> : (
        <Card className="mb-5">
          <CardHeader><CardTitle>Settings</CardTitle>{s && <Badge tone={s.enabled ? 'success' : 'neutral'}>{s.enabled ? 'COD enabled' : 'COD disabled'}</Badge>}</CardHeader>
          <CardContent>
            {!s ? <Skeleton className="h-20" /> : (
              <>
                <KeyValue items={[
                  { label: 'Cash on Delivery', value: s.enabled ? 'Offered at checkout' : 'Turned off for all customers' },
                  { label: 'Auto-block after', value: `${formatNumber(s.rtoBlockThreshold)} RTO parcel${s.rtoBlockThreshold === 1 ? '' : 's'} per phone` },
                  { label: 'Confirm window', value: `${formatNumber(s.confirmWindowHours)} h (unconfirmed COD orders auto-cancel)` },
                  { label: 'Prepaid discount', value: s.prepaidDiscountPercent > 0 ? `${s.prepaidDiscountPercent}% off when paying online, up to ${formatINR(s.prepaidDiscountMax)}` : 'None' },
                ]} />
                <p className="mt-3 text-xs text-muted">These values come from server configuration (COD_* environment variables) and are changed by redeploying the API.</p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {canAnalytics && (
        <section className="mb-5" aria-label="COD analytics">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold">Performance</h2>
            <Segmented size="sm" label="Period" value={f.period as Period} onChange={(period) => setF({ period })} options={PERIODS.map((p) => ({ value: p.value, label: p.label }))} />
          </div>
          {analytics.error && !analytics.data ? <ErrorState error={analytics.error} onRetry={() => void analytics.mutate()} /> : (
            <>
              <CodKpis data={analytics.data} />
              <Card className="mt-3">
                <CardHeader><CardTitle>Top RTO PIN codes</CardTitle></CardHeader>
                <CardContent>
                  {!analytics.data ? <Skeleton className="h-24" /> : analytics.data.topRtoPincodes.length === 0 ? <p className="text-sm text-muted">No parcels returned to origin in this period.</p> : (
                    <ul className="divide-y divide-border text-sm">
                      {analytics.data.topRtoPincodes.map((p) => (
                        <li key={p.pincode} className="flex flex-wrap items-center justify-between gap-2 py-2">
                          <span className="flex items-center gap-2"><MapPinOff className="size-4 text-subtle" /><span className="font-mono font-medium">{p.pincode}</span>
                            <span className="tabular text-muted">{formatNumber(p.rto)} RTO / {formatNumber(p.orders)} orders ({p.orders ? ((p.rto / p.orders) * 100).toFixed(0) : 0}%)</span></span>
                          {blockedSet.has(p.pincode) ? <Badge tone="danger">COD blocked</Badge> : canWrite && (
                            <Button size="sm" variant="outline" className="text-danger hover:border-danger" loading={blockingPin === p.pincode} onClick={() => void blockTopPin(p)}><ShieldBan /> Block COD</Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </section>
      )}

      <section className="mb-5" aria-label="Blocked PIN codes">
        <h2 className="mb-2 text-sm font-bold">Blocked PIN codes</h2>
        <DataTable columns={pinCols} data={s?.blockedPincodes} isLoading={settings.isLoading} error={settings.error} onRetry={() => void settings.mutate()} getRowId={(r) => r.pincode} dense
          empty={{ icon: <MapPinOff />, title: 'No PIN codes blocked', description: 'COD is available to every serviceable PIN code.' }}
          toolbar={canWrite ? <BlockedPincodeForm onSaved={setSettings} /> : undefined} />
      </section>

      <section aria-label="Customer COD risk">
        <h2 className="mb-2 text-sm font-bold">Customer risk</h2>
        <DataTable columns={riskCols} data={risks.data} isLoading={risks.isLoading} error={risks.error} onRetry={() => void risks.mutate()} getRowId={(r) => r.phone} dense
          empty={{ title: 'No COD risk records', description: 'Phones appear here after an RTO or a manual block.' }}
          toolbar={
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <SearchInput value={f.q} onChange={(q) => setF({ q })} placeholder="Search by phone" label="Search by phone" />
              <Segmented size="sm" label="COD status" value={f.blocked as 'all' | 'true' | 'false'} onChange={(blocked) => setF({ blocked })} options={[{ value: 'all', label: 'All' }, { value: 'true', label: 'Blocked' }, { value: 'false', label: 'Allowed' }]} />
            </div>
          }
          footer={<Pagination meta={risks.meta} isValidating={risks.isValidating} onPageChange={(p) => setF({ page: String(p) })} />} />
      </section>
    </>
  );
}
