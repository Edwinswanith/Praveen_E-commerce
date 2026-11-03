'use client';

import * as React from 'react';
import type { ReturnPreviewDto } from '@vyra/shared';
import { formatINR } from '@vyra/shared';
import { Button, Skeleton } from '@vyra/ui';
import { api, errorMessage } from '@/lib/api';

export interface ReturnSelection {
  orderItemId: string;
  quantity: number;
}

const keyOf = (items: ReturnSelection[]) =>
  items
    .map((i) => `${i.orderItemId}:${i.quantity}`)
    .sort()
    .join(',');

/**
 * Asks the server what a return of exactly these items would refund, every
 * time the selection changes. `ready` is true only when the preview on screen
 * matches the current selection, so the caller can hold the submit button.
 */
export function useReturnPreview(orderNumber: string, items: ReturnSelection[], enabled: boolean) {
  const key = enabled && items.length > 0 ? keyOf(items) : '';
  const [state, setState] = React.useState<{
    key: string;
    data: ReturnPreviewDto | null;
    error: string | null;
  }>({ key: '', data: null, error: null });
  const [attempt, setAttempt] = React.useState(0);
  const itemsRef = React.useRef(items);
  itemsRef.current = items;

  React.useEffect(() => {
    if (!key) return;
    let live = true;
    api<ReturnPreviewDto>(`/orders/${encodeURIComponent(orderNumber)}/return-preview`, {
      method: 'POST',
      body: { items: itemsRef.current },
    })
      .then((data) => live && setState({ key, data, error: null }))
      .catch((e) => live && setState({ key, data: null, error: errorMessage(e, 'Couldn’t work out the refund.') }));
    return () => {
      live = false;
    };
  }, [key, orderNumber, attempt]);

  const current = key && state.key === key ? state : null;
  return {
    preview: current?.data ?? null,
    error: current?.error ?? null,
    loading: !!key && !current,
    ready: !!current?.data,
    retry: () => {
      setState({ key: '', data: null, error: null });
      setAttempt((a) => a + 1);
    },
  };
}

export function ReturnPreviewPanel({
  preview,
  loading,
  error,
  onRetry,
}: {
  preview: ReturnPreviewDto | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading) return <Skeleton className="h-24" />;
  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
        {error}{' '}
        <Button variant="link" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  if (!preview) return null;
  return (
    <section
      aria-label="Refund preview"
      aria-live="polite"
      className="rounded-md border border-border bg-surface p-3 text-sm"
      data-testid="return-preview"
    >
      <dl className="space-y-1.5">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">You paid for these items</dt>
          <dd className="tabular-nums">{formatINR(preview.itemsValue)}</dd>
        </div>
        {preview.deductions.map((d, i) => (
          <div key={`${d.label}-${i}`} className="flex justify-between gap-3">
            <dt className="text-muted">{d.label}</dt>
            <dd className={d.amount < 0 ? 'shrink-0 tabular-nums text-teal-600' : 'shrink-0 tabular-nums text-danger'}>
              {d.amount < 0 ? `+${formatINR(-d.amount)}` : `−${formatINR(d.amount)}`}
            </dd>
          </div>
        ))}
        <div className="flex justify-between gap-3 border-t border-border pt-2 font-bold">
          <dt>Your refund</dt>
          <dd className="tabular-nums" data-testid="refund-amount">
            {formatINR(preview.refundAmount)}
          </dd>
        </div>
      </dl>
      {preview.note && <p className="mt-2 text-xs text-muted">{preview.note}</p>}
    </section>
  );
}
