'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import type { CustomerSummaryDto, OrderSummaryDto } from '@vyra/shared';
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@vyra/ui';
import { ArrowLeft, Users } from 'lucide-react';
import { useApi } from '@/lib/swr';
import { useUrlState } from '@/hooks/use-url-state';
import { useAuth } from '@/features/auth/auth-context';
import { PERM } from '@/lib/permissions';
import type { CustomerDetailDto } from '@/lib/types';
import { formatDate, formatDateTime, formatINR, formatNumber } from '@/lib/format';
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE } from '@/lib/status';
import { DataTable } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import { SearchInput } from '@/components/data-table/search-input';
import { ErrorState, KeyValue, PageHeader, StatCard, StatusBadge } from '@/components/ui/feedback';

const columns: ColumnDef<CustomerSummaryDto, unknown>[] = [
  { header: 'Customer', id: 'name', cell: ({ row: { original: c } }) => <span className="block min-w-48"><span className="block font-medium">{c.name}</span><span className="block text-xs text-muted">{c.email}</span></span> },
  { header: 'Phone', accessorKey: 'phone', cell: ({ row }) => row.original.phone ?? '—' },
  { header: 'Orders', accessorKey: 'orders', meta: { align: 'right' }, cell: ({ row }) => formatNumber(row.original.orders) },
  { header: 'Total spent', accessorKey: 'totalSpent', meta: { align: 'right' }, cell: ({ row }) => <span className="font-medium">{formatINR(row.original.totalSpent)}</span> },
  { header: 'Last order', accessorKey: 'lastOrderAt', cell: ({ row }) => <span className="text-muted">{formatDate(row.original.lastOrderAt)}</span> },
  { header: 'Joined', accessorKey: 'createdAt', cell: ({ row }) => <span className="text-muted">{formatDate(row.original.createdAt)}</span> },
];

export function CustomersList() {
  const router = useRouter();
  const [f, setF] = useUrlState({ q: '', page: '1' });
  const { data, meta, error, isLoading, isValidating, mutate } = useApi<CustomerSummaryDto[]>('/customers', { q: f.q, page: f.page, pageSize: 25 });
  return (
    <>
      <PageHeader title="Customers" description="Registered shoppers and their lifetime value." />
      <DataTable columns={columns} data={data} isLoading={isLoading} error={error} onRetry={() => void mutate()} getRowId={(c) => c.id}
        onRowClick={(c) => router.push(`/customers/${c.id}`)} empty={{ icon: <Users />, title: 'No customers found' }}
        toolbar={<SearchInput value={f.q} onChange={(q) => setF({ q })} placeholder="Name, email or phone" />}
        footer={<Pagination meta={meta} isValidating={isValidating} onPageChange={(p) => setF({ page: String(p) })} />} />
    </>
  );
}

const orderCols: ColumnDef<OrderSummaryDto, unknown>[] = [
  { header: 'Order', accessorKey: 'number', cell: ({ row }) => <span className="font-medium">{row.original.number}</span> },
  { header: 'Placed', accessorKey: 'createdAt', cell: ({ row }) => <span className="text-muted">{formatDateTime(row.original.createdAt)}</span> },
  { header: 'Status', accessorKey: 'status', cell: ({ row }) => <StatusBadge value={row.original.status} tone={ORDER_STATUS_TONE[row.original.status]} label={ORDER_STATUS_LABEL[row.original.status]} /> },
  { header: 'Total', accessorKey: 'grandTotal', meta: { align: 'right' }, cell: ({ row }) => formatINR(row.original.grandTotal) },
];

export function CustomerDetail({ id }: { id: string }) {
  const router = useRouter();
  const { can } = useAuth();
  const { data: c, error, isLoading, mutate } = useApi<CustomerDetailDto>(`/customers/${id}`);
  const embedded = c ? (Array.isArray(c.orders) ? c.orders : c.recentOrders) : undefined;
  const orderCount = c ? (c.stats?.orders ?? (Array.isArray(c.orders) ? c.orders.length : c.orders)) : 0;
  const totalSpent = c ? (c.stats?.totalSpent ?? c.totalSpent ?? 0) : 0;
  const lastOrderAt = c ? (c.lastOrderAt ?? embedded?.[0]?.createdAt ?? null) : null;
  // Fall back to the orders endpoint when the detail payload has no order list.
  const { data: fetchedOrders, isLoading: ordersLoading } = useApi<OrderSummaryDto[]>(c && !embedded && can(PERM.ordersRead) ? '/orders' : null, { q: c?.email, pageSize: 20 });
  const orders = embedded ?? fetchedOrders;
  const back = <Link href="/customers" className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-fg"><ArrowLeft className="size-3.5" /> Customers</Link>;

  if (error && !c) return <>{back}<ErrorState error={error} onRetry={() => void mutate()} /></>;
  if (isLoading || !c) return <div className="space-y-4"><Skeleton className="h-8 w-60" /><Skeleton className="h-64" /></div>;

  return (
    <>
      <PageHeader back={back} title={c.name} description={c.email} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Orders" value={formatNumber(orderCount)} />
        <StatCard label="Total spent" value={formatINR(totalSpent)} />
        <StatCard label="Average order" value={orderCount ? formatINR(Math.round((totalSpent / orderCount) * 100) / 100) : '—'} />
        <StatCard label="Last order" value={<span className="text-lg">{formatDate(lastOrderAt)}</span>} />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-2 text-sm font-bold">Orders</h2>
          <DataTable columns={orderCols} data={orders} isLoading={!orders && ordersLoading} getRowId={(o) => o.id} onRowClick={(o) => router.push(`/orders/${o.id}`)} empty={{ title: 'No orders yet' }} />
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
            <CardContent>
              <KeyValue items={[
                { label: 'Email', value: <span className="flex flex-wrap items-center gap-1.5">{c.email}{c.emailVerified !== undefined && <Badge tone={c.emailVerified ? 'success' : 'warning'}>{c.emailVerified ? 'Verified' : 'Unverified'}</Badge>}</span> },
                { label: 'Phone', value: c.phone ?? '—' },
                { label: 'Joined', value: formatDate(c.createdAt) },
                { label: 'Last login', value: formatDateTime(c.lastLoginAt) },
                ...(c.stats ? [{ label: 'Returns', value: formatNumber(c.stats.returns) }] : []),
              ]} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Addresses</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {!c.addresses?.length && <p className="text-muted">No saved addresses.</p>}
              {c.addresses?.map((a) => (
                <div key={a.id} className="rounded-md border border-border p-3 leading-relaxed">
                  <p className="flex items-center gap-2 font-medium">{a.fullName}<Badge tone="neutral">{a.type}</Badge>{a.isDefault && <Badge tone="info">Default</Badge>}</p>
                  <p>{a.line1}{a.line2 ? `, ${a.line2}` : ''}</p>
                  <p>{a.city}, {a.state} {a.pincode}</p>
                  <p className="text-muted">{a.phone}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
