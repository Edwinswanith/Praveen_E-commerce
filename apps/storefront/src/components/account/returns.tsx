'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { RotateCcw } from 'lucide-react';
import type { ReturnRequestDto } from '@vyra/shared';
import { formatINR } from '@vyra/shared';
import { Alert, Badge, EmptyState, Skeleton } from '@vyra/ui';
import { errorMessage } from '@/lib/api';
import { formatDate, RETURN_REASONS, RETURN_STATUS_LABEL, RETURN_STATUS_TONE } from '@/lib/format';
import { PageHeader } from '../ui/page-header';

export function ReturnsPage() {
  const { data, error, isLoading } = useSWR<ReturnRequestDto[]>('/returns');
  return (
    <div className="space-y-6">
      <PageHeader
        title="Returns"
        subtitle="Returns and exchanges can be requested within 14 days of delivery from the order page."
      />
      {isLoading && <Skeleton className="h-32" />}
      {error && <Alert tone="danger">{errorMessage(error)}</Alert>}
      {data && data.length === 0 && (
        <EmptyState
          icon={<RotateCcw />}
          title="No returns or exchanges"
          description="You haven’t requested any returns or exchanges."
        />
      )}
      {data && data.length > 0 && (
        <ul className="space-y-3">
          {data.map((r) => (
            <li key={r.id} className="rounded-lg border border-border p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={`/account/orders/${encodeURIComponent(r.orderNumber)}`}
                  className="font-bold hover:underline"
                >
                  Order {r.orderNumber}
                </Link>
                <span className="flex items-center gap-2">
                  <Badge tone="neutral">{r.type === 'EXCHANGE' ? 'Exchange' : 'Return'}</Badge>
                  <Badge tone={RETURN_STATUS_TONE[r.status]}>{RETURN_STATUS_LABEL[r.status]}</Badge>
                </span>
              </div>
              <p className="mt-1 text-xs text-muted">
                Requested {formatDate(r.createdAt)} ·{' '}
                {RETURN_REASONS.find((x) => x.value === r.reason)?.label ?? r.reason}
              </p>
              <ul className="mt-2 text-sm">
                {r.items.map((i) => (
                  <li key={i.orderItemId}>
                    {i.name} <span className="text-muted">×{i.quantity}</span>
                    {i.exchangeFor && (
                      <span className="text-muted">
                        {' '}
                        → {i.exchangeFor.color} · {i.exchangeFor.size}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {r.refundAmount > 0 && (
                <p className="mt-2 font-semibold text-teal-600">
                  Refund: {formatINR(r.refundAmount)}
                </p>
              )}
              {r.replacementOrderNumber && (
                <p className="mt-2 text-sm">
                  Replacement order{' '}
                  <Link
                    href={`/account/orders/${encodeURIComponent(r.replacementOrderNumber)}`}
                    className="font-semibold text-brand-600 hover:underline"
                  >
                    {r.replacementOrderNumber}
                  </Link>
                </p>
              )}
              {r.comments && <p className="mt-1 text-xs text-muted">“{r.comments}”</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
