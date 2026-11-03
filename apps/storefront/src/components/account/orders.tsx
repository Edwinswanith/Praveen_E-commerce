'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { ChevronRight, Package } from 'lucide-react';
import type { OrderSummaryDto, PageMeta } from '@vyra/shared';
import { formatINR } from '@vyra/shared';
import { Alert, Button, EmptyState, Skeleton } from '@vyra/ui';
import { apiEnvelope, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { ProductImage } from '../product/product-image';
import { PageHeader } from '../ui/page-header';
import { OrderStatusBadge } from './order-parts';

export function OrdersPage() {
  const [page, setPage] = React.useState(1);
  const { data, error, isLoading } = useSWR(
    `/orders?page=${page}`,
    (k: string) => apiEnvelope<OrderSummaryDto[]>(k),
    { keepPreviousData: true },
  );
  const orders = data?.data;
  const meta: PageMeta | undefined = data?.meta;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        subtitle={meta ? `${meta.total} order${meta.total === 1 ? '' : 's'}` : undefined}
      />
      {isLoading && !orders && (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      )}
      {error && <Alert tone="danger">{errorMessage(error)}</Alert>}
      {orders && orders.length === 0 && (
        <EmptyState
          icon={<Package />}
          title="No orders yet"
          description="When you place an order it will show up here."
          action={
            <Button asChild>
              <Link href="/products">Start shopping</Link>
            </Button>
          }
        />
      )}
      {orders && orders.length > 0 && (
        <ul className="space-y-3">
          {orders.map((o) => (
            <li key={o.id}>
              <Link
                href={`/account/orders/${encodeURIComponent(o.number)}`}
                className="flex items-center gap-4 rounded-lg border border-border p-4 transition-shadow hover:shadow-card"
              >
                <div className="flex -space-x-6">
                  {(o.previewImages.length ? o.previewImages.slice(0, 3) : [null]).map((src, i) => (
                    <span
                      key={i}
                      className="relative aspect-[3/4] w-14 overflow-hidden rounded-md border-2 border-bg bg-surface-2"
                    >
                      <ProductImage src={src} alt="" fill sizes="56px" className="object-cover" />
                    </span>
                  ))}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold">{o.number}</p>
                    <OrderStatusBadge status={o.status} />
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    Placed {formatDate(o.createdAt)} · {o.itemCount} item
                    {o.itemCount === 1 ? '' : 's'}
                  </p>
                  <p className="mt-1 text-sm font-semibold">{formatINR(o.grandTotal)}</p>
                </div>
                <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-muted">
            Page {meta.page} of {meta.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= meta.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
