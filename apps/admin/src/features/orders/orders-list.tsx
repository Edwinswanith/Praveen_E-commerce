'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import type { OrderStatus, OrderSummaryDto } from '@vyra/shared';
import { OrderStatus as OS } from '@vyra/shared';
import { Badge, Input, cn } from '@vyra/ui';
import { ShoppingBag } from 'lucide-react';
import { useApi } from '@/lib/swr';
import { useUrlState } from '@/hooks/use-url-state';
import { dayToIso, formatDateTime, formatINR, formatNumber, humanize } from '@/lib/format';
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE, PAYMENT_STATUS_TONE } from '@/lib/status';
import { DataTable } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import { SearchInput } from '@/components/data-table/search-input';
import { PageHeader, StatusBadge } from '@/components/ui/feedback';

const TABS: ('ALL' | OrderStatus)[] = ['ALL', OS.PENDING_PAYMENT, OS.CONFIRMED, OS.PACKED, OS.SHIPPED, OS.OUT_FOR_DELIVERY, OS.DELIVERED, OS.CANCELLED, OS.RETURNED];

const columns: ColumnDef<OrderSummaryDto, unknown>[] = [
  {
    header: 'Order', accessorKey: 'number',
    cell: ({ row: { original: o } }) => (
      <div className="flex items-center gap-2.5">
        <div className="flex -space-x-2">
          {o.previewImages.slice(0, 2).map((src, i) => <img key={i} src={src} alt="" className="size-8 rounded-md object-cover ring-2 ring-bg" loading="lazy" />)}
        </div>
        <span className="whitespace-nowrap font-medium">{o.number}</span>
      </div>
    ),
  },
  { header: 'Placed', accessorKey: 'createdAt', cell: ({ row }) => <span className="whitespace-nowrap text-muted">{formatDateTime(row.original.createdAt)}</span> },
  { header: 'Customer', id: 'customer', cell: ({ row: { original: o } }) => <span className="block max-w-56"><span className="block truncate">{o.customerName}</span><span className="block truncate text-xs text-muted">{o.customerEmail}</span></span> },
  { header: 'Items', accessorKey: 'itemCount', meta: { align: 'right' }, cell: ({ row }) => formatNumber(row.original.itemCount) },
  {
    header: 'Payment', id: 'payment',
    cell: ({ row: { original: o } }) => (
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        <span className="text-xs font-medium">{o.paymentMethod}</span>
        {o.paymentStatus && <Badge tone={PAYMENT_STATUS_TONE[o.paymentStatus]}>{humanize(o.paymentStatus)}</Badge>}
      </span>
    ),
  },
  { header: 'Status', accessorKey: 'status', cell: ({ row }) => <StatusBadge value={row.original.status} tone={ORDER_STATUS_TONE[row.original.status]} label={ORDER_STATUS_LABEL[row.original.status]} /> },
  { header: 'Total', accessorKey: 'grandTotal', meta: { align: 'right' }, cell: ({ row }) => <span className="font-medium">{formatINR(row.original.grandTotal)}</span> },
];

export function OrdersList() {
  const router = useRouter();
  const [f, setF] = useUrlState({ status: 'ALL', q: '', from: '', to: '', page: '1' });
  const { data, meta, error, isLoading, isValidating, mutate } = useApi<OrderSummaryDto[]>('/orders', {
    status: f.status === 'ALL' ? undefined : f.status, q: f.q, from: dayToIso(f.from, 'start'), to: dayToIso(f.to, 'end'), page: f.page, pageSize: 25,
  });
  return (
    <>
      <PageHeader title="Orders" description="Fulfil, ship, refund and track customer orders." />
      <div role="tablist" aria-label="Order status" className="-mx-3 mb-3 flex gap-1 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        {TABS.map((t) => (
          <button key={t} role="tab" type="button" aria-selected={f.status === t} onClick={() => setF({ status: t })}
            className={cn('shrink-0 rounded-md px-3 py-1.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-fg', f.status === t && 'bg-bg text-fg shadow-sm ring-1 ring-border')}>
            {t === 'ALL' ? 'All' : ORDER_STATUS_LABEL[t]}
          </button>
        ))}
      </div>
      <DataTable
        columns={columns}
        data={data}
        isLoading={isLoading}
        error={error}
        onRetry={() => void mutate()}
        getRowId={(o) => o.id}
        onRowClick={(o) => router.push(`/orders/${o.id}`)}
        empty={{ icon: <ShoppingBag />, title: 'No orders found', description: 'Try a different status, search or date range.' }}
        toolbar={
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <SearchInput value={f.q} onChange={(q) => setF({ q })} placeholder="Order number, name, email, phone" />
            <div className="flex items-center gap-2">
              <Input type="date" aria-label="From date" value={f.from} max={f.to || undefined} onChange={(e) => setF({ from: e.target.value })} className="h-9 w-40" />
              <span className="text-xs text-muted">to</span>
              <Input type="date" aria-label="To date" value={f.to} min={f.from || undefined} onChange={(e) => setF({ to: e.target.value })} className="h-9 w-40" />
              {(f.from || f.to) && <button type="button" className="text-xs font-medium text-muted hover:text-fg" onClick={() => setF({ from: '', to: '' })}>Clear</button>}
            </div>
          </div>
        }
        footer={<Pagination meta={meta} isValidating={isValidating} onPageChange={(p) => setF({ page: String(p) })} />}
      />
    </>
  );
}
