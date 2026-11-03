'use client';
import * as React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import type { OrderSummaryDto } from '@vyra/shared';
import { Alert, Badge, Button, Card, Skeleton, cn } from '@vyra/ui';
import { CheckCircle2, PackageCheck, Search, X, AlertOctagon } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/swr';
import type { AdminOrderDetail, DispatchLine } from '@/lib/types';
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE } from '@/lib/status';
import { formatNumber } from '@/lib/format';
import { StatusBadge } from '@/components/ui/feedback';

export interface DispatchProgress { total: number; scanned: number; complete: boolean; over: DispatchLine[]; short: DispatchLine[] }

export function dispatchProgress(lines: DispatchLine[]): DispatchProgress {
  const total = lines.reduce((s, l) => s + l.expected, 0);
  const scanned = lines.reduce((s, l) => s + Math.min(l.scanned, l.expected), 0);
  const over = lines.filter((l) => l.scanned > l.expected);
  const short = lines.filter((l) => l.scanned < l.expected);
  return { total, scanned, complete: lines.length > 0 && short.length === 0 && over.length === 0, over, short };
}

/** Order picker by order number (resolves to the order id required by the scan API). */
export function OrderLookup({ onSelect, autoFocus }: { onSelect: (id: string) => void; autoFocus?: boolean }) {
  const [q, setQ] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [matches, setMatches] = React.useState<OrderSummaryDto[] | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    setPending(true);
    try {
      // The API accepts an order number in place of the id; try a direct lookup first.
      const direct = await api.get<{ id: string; number: string }>(`/orders/${encodeURIComponent(term.toUpperCase())}`).catch(() => null);
      if (direct?.id) { onSelect(direct.id); setMatches(null); setQ(''); return; }
      const rows = await api.get<OrderSummaryDto[]>('/orders', { q: term, pageSize: 10 });
      const exact = rows.find((r) => r.number.toLowerCase() === term.toLowerCase());
      if (exact) { onSelect(exact.id); setMatches(null); setQ(''); }
      else setMatches(rows);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="space-y-2">
      <form onSubmit={submit} className="flex gap-2">
        <div className="relative flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus={autoFocus} aria-label="Order number" placeholder="Order number, e.g. VY-24-000123"
            className="h-11 w-full rounded-md border border-border-strong bg-bg pl-9 pr-3 text-sm uppercase placeholder:normal-case placeholder:text-subtle focus:border-fg focus:outline-none" />
        </div>
        <Button type="submit" variant="secondary" loading={pending} className="h-11">Load order</Button>
      </form>
      {matches && (
        <div className="rounded-md border border-border">
          {matches.length === 0 ? <p className="px-3 py-2.5 text-sm text-muted">No orders match “{q}”.</p> : matches.map((m) => (
            <button key={m.id} type="button" onClick={() => { onSelect(m.id); setMatches(null); setQ(''); }} className="flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left text-sm last:border-0 hover:bg-surface">
              <span><span className="font-medium">{m.number}</span> <span className="text-muted">· {m.customerName}</span></span>
              <StatusBadge value={m.status} tone={ORDER_STATUS_TONE[m.status]} label={ORDER_STATUS_LABEL[m.status]} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function DispatchPanel({ orderId, onClear, canPack, mismatch }: { orderId: string; onClear: () => void; canPack: boolean; mismatch: string | null }) {
  const { data: order, error, isLoading, mutate } = useApi<AdminOrderDetail>(`/orders/${orderId}`);
  const [packing, setPacking] = React.useState(false);

  if (error && !order) return <Alert tone="danger" title="Could not load order">{errorMessage(error)} <button className="underline" onClick={onClear}>Choose another</button></Alert>;
  if (isLoading || !order) return <Skeleton className="h-48" />;

  const lines = order.dispatch ?? [];
  const progress = dispatchProgress(lines);
  const itemFor = (l: DispatchLine) => order.items.find((i) => i.variantId === l.variantId);
  const packable = order.status === 'CONFIRMED';

  const markPacked = async () => {
    setPacking(true);
    try {
      await api.post(`/orders/${order.id}/status`, { status: 'PACKED', note: 'Dispatch verified by barcode scan' });
      toast.success(`${order.number} marked as packed`);
      void mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPacking(false);
    }
  };

  return (
    <Card className={cn('overflow-hidden', mismatch && 'animate-flash-danger border-danger')}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-bold"><Link href={`/orders/${order.id}`} className="hover:underline">{order.number}</Link><StatusBadge value={order.status} tone={ORDER_STATUS_TONE[order.status]} label={ORDER_STATUS_LABEL[order.status]} /></p>
          <p className="truncate text-xs text-muted">{order.customerName} · {order.shippingAddress.city}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClear} aria-label="Change order"><X /> Change</Button>
      </div>
      {mismatch && (
        <div role="alert" className="flex items-start gap-3 bg-danger px-4 py-3 text-white">
          <AlertOctagon className="mt-0.5 size-6 shrink-0" aria-hidden />
          <div><p className="text-base font-bold uppercase tracking-wide">Wrong item</p><p className="text-sm text-white/90">{mismatch}</p></div>
        </div>
      )}
      <div className="px-4 py-3">
        <div className="mb-1 flex items-baseline justify-between text-sm"><span className="font-medium">Verified</span><span className="tabular font-semibold">{formatNumber(progress.scanned)} / {formatNumber(progress.total)}</span></div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.scanned} aria-label="Dispatch verification progress">
          <div className={cn('h-full rounded-full transition-[width]', progress.complete ? 'bg-success' : 'bg-violet-500')} style={{ width: `${progress.total ? (progress.scanned / progress.total) * 100 : 0}%` }} />
        </div>
      </div>
      <ul className="divide-y divide-border border-t border-border">
        {lines.map((l) => {
          const item = itemFor(l);
          const state = l.scanned > l.expected ? 'over' : l.scanned === l.expected ? 'done' : 'todo';
          return (
            <li key={l.variantId} className={cn('flex items-center gap-3 px-4 py-2.5', state === 'over' && 'bg-red-50', state === 'done' && 'bg-emerald-50/50')}>
              <span className="size-11 shrink-0 overflow-hidden rounded-md bg-surface-2">{item?.imageUrl && <img src={item.imageUrl} alt="" className="size-full object-cover" />}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{item?.name ?? l.sku}</span>
                <span className="block truncate font-mono text-xs text-muted">{l.sku}{item ? ` · ${item.color}/${item.size}` : ''}</span>
              </span>
              <span className={cn('tabular text-right text-lg font-bold', state === 'over' ? 'text-danger' : state === 'done' ? 'text-success' : 'text-fg')}>
                {l.scanned}<span className="text-sm font-medium text-muted">/{l.expected}</span>
              </span>
              {state === 'done' && <CheckCircle2 className="size-5 text-success" aria-label="Complete" />}
              {state === 'over' && <Badge tone="danger">+{l.scanned - l.expected} extra</Badge>}
            </li>
          );
        })}
        {lines.length === 0 && <li className="px-4 py-4 text-sm text-muted">This order has no items to dispatch.</li>}
      </ul>
      <div className="space-y-2 border-t border-border bg-surface px-4 py-3">
        {progress.over.length > 0 && <Alert tone="danger">Too many units scanned for {progress.over.map((o) => o.sku).join(', ')}. Remove the extra item(s) from the parcel.</Alert>}
        {!packable && <p className="text-xs text-muted">Only confirmed orders can be marked packed (current: {ORDER_STATUS_LABEL[order.status]}).</p>}
        <Button block size="lg" disabled={!progress.complete || !packable || !canPack} loading={packing} onClick={() => void markPacked()}>
          <PackageCheck /> {progress.complete ? 'Mark packed' : `Scan ${formatNumber(progress.total - progress.scanned)} more item(s)`}
        </Button>
      </div>
    </Card>
  );
}
