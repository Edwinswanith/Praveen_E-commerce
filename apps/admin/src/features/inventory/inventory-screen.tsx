'use client';
import * as React from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import type { InventoryMovementDto, InventoryRowDto } from '@vyra/shared';
import { Button, Skeleton } from '@vyra/ui';
import { Boxes, Download, History, PackagePlus, Wallet, AlertTriangle, PackageX, Lock } from 'lucide-react';
import { useApi } from '@/lib/swr';
import { useUrlState } from '@/hooks/use-url-state';
import { useAuth } from '@/features/auth/auth-context';
import { PERM } from '@/lib/permissions';
import { formatINR, formatNumber, formatDateTime } from '@/lib/format';
import { STOCK_STATUS } from '@/lib/status';
import { downloadFile } from '@/lib/download';
import { errorMessage } from '@/lib/api';
import type { InventorySummary } from '@/lib/types';
import { DataTable } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import { SearchInput } from '@/components/data-table/search-input';
import { PageHeader, StatCard, StatusBadge } from '@/components/ui/feedback';
import { Segmented } from '@/components/ui/controls';
import { Dialog, Sheet } from '@/components/ui/dialog';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { MovementForm } from './movement-form';
import { movementColumns } from './movement-history';

function readSummary(extra: Record<string, unknown> | undefined, meta: unknown): InventorySummary | null {
  const candidate = (extra?.summary ?? (meta as { summary?: unknown } | undefined)?.summary) as InventorySummary | undefined;
  return candidate && typeof candidate === 'object' ? candidate : null;
}

export function ExportMenu({ path, name, query }: { path: string; name: string; query?: Record<string, string | undefined> }) {
  const [pending, setPending] = React.useState(false);
  const run = async (format: 'csv' | 'xlsx') => {
    setPending(true);
    try { await downloadFile(path, `${name}.${format}`, { query: { ...query, format } }); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setPending(false); }
  };
  return (
    <Menu>
      <MenuTrigger asChild><Button variant="outline" size="sm" loading={pending}><Download /> Export</Button></MenuTrigger>
      <MenuContent>
        <MenuItem onSelect={() => void run('csv')}>CSV</MenuItem>
        <MenuItem onSelect={() => void run('xlsx')}>Excel (XLSX)</MenuItem>
      </MenuContent>
    </Menu>
  );
}

export function InventoryScreen() {
  const { can } = useAuth();
  const canWrite = can(PERM.inventoryWrite);
  const [filters, setFilters] = useUrlState({ q: '', status: 'ALL', page: '1' });
  const { data, meta, extra, error, isLoading, isValidating, mutate } = useApi<InventoryRowDto[]>('/inventory', {
    q: filters.q, status: filters.status === 'ALL' ? undefined : filters.status, page: filters.page, pageSize: 25,
  });
  const summary = readSummary(extra, meta);
  const [moving, setMoving] = React.useState<InventoryRowDto | null>(null);
  const [history, setHistory] = React.useState<InventoryRowDto | null>(null);

  const columns = React.useMemo<ColumnDef<InventoryRowDto, unknown>[]>(() => [
    {
      id: 'variant', header: 'Variant',
      cell: ({ row: { original: r } }) => (
        <span className="block min-w-48">
          <Link href={`/products/${r.productId}`} onClick={(e) => e.stopPropagation()} className="block truncate font-medium hover:underline">{r.productName}</Link>
          <span className="text-xs text-muted">{r.color} / {r.size}</span>
        </span>
      ),
    },
    { header: 'SKU', accessorKey: 'sku', cell: ({ row }) => <span className="block font-mono text-xs">{row.original.sku}<span className="block text-muted">{row.original.barcode ?? '—'}</span></span> },
    { header: 'Status', accessorKey: 'status', cell: ({ row }) => <StatusBadge value={row.original.status} {...STOCK_STATUS[row.original.status]} /> },
    { header: 'On hand', accessorKey: 'onHand', meta: { align: 'right' }, cell: ({ row }) => formatNumber(row.original.onHand) },
    { header: 'Reserved', accessorKey: 'reserved', meta: { align: 'right' }, cell: ({ row }) => <span className="text-muted">{formatNumber(row.original.reserved)}</span> },
    {
      header: 'Available', accessorKey: 'available', meta: { align: 'right' },
      cell: ({ row: { original: r } }) => <span className={r.available === 0 ? 'font-semibold text-danger' : r.available <= r.lowStockThreshold ? 'font-semibold text-warning' : 'font-semibold'}>{formatNumber(r.available)}</span>,
    },
    { header: 'Low at', accessorKey: 'lowStockThreshold', meta: { align: 'right' }, cell: ({ row }) => <span className="text-muted">{formatNumber(row.original.lowStockThreshold)}</span> },
    { header: 'Value', accessorKey: 'stockValue', meta: { align: 'right' }, cell: ({ row }) => formatINR(row.original.stockValue) },
    { header: 'Updated', accessorKey: 'updatedAt', cell: ({ row }) => <span className="whitespace-nowrap text-xs text-muted">{formatDateTime(row.original.updatedAt)}</span> },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>,
      cell: ({ row: { original: r } }) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" onClick={() => setHistory(r)} aria-label={`Movement history for ${r.sku}`}><History /></Button>
          {canWrite && <Button variant="outline" size="sm" onClick={() => setMoving(r)}>Adjust</Button>}
        </div>
      ),
    },
  ], [canWrite]);

  return (
    <>
      <PageHeader
        title="Stock"
        description="On-hand, reserved and available units per variant. Every change is recorded as a movement."
        actions={<>
          <ExportMenu path="/inventory/export" name="vyra-inventory" />
          <Button asChild variant="outline" size="sm"><Link href="/inventory/movements"><History /> Ledger</Link></Button>
          {canWrite && <Button asChild size="sm"><Link href="/inventory/purchase-orders/new"><PackagePlus /> Purchase order</Link></Button>}
        </>}
      />
      <section aria-label="Inventory summary" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {summary || isLoading ? (
          <>
            <StatCard loading={!summary} label="Units on hand" icon={<Boxes />} value={formatNumber(summary?.units)} />
            <StatCard loading={!summary} label="Reserved" icon={<Lock />} value={formatNumber(summary?.reserved)} hint={summary ? `${formatNumber(summary.available)} available` : undefined} />
            <StatCard loading={!summary} label="Valuation (cost)" icon={<Wallet />} value={summary ? formatINR(summary.valuation) : ''} hint={summary?.retailValue !== undefined ? `${formatINR(summary.retailValue)} at retail` : undefined} />
            <StatCard loading={!summary} label="Low stock" icon={<AlertTriangle />} value={formatNumber(summary?.lowStock)} tone={summary && summary.lowStock > 0 ? 'warning' : 'default'} />
            <StatCard loading={!summary} label="Out of stock" icon={<PackageX />} value={formatNumber(summary?.outOfStock)} tone={summary && summary.outOfStock > 0 ? 'danger' : 'default'} />
          </>
        ) : data ? null : <Skeleton className="col-span-full h-20" />}
      </section>
      <DataTable
        columns={columns}
        data={data}
        isLoading={isLoading}
        error={error}
        onRetry={() => void mutate()}
        getRowId={(r) => r.variantId}
        onRowClick={(r) => setHistory(r)}
        dense
        empty={{ icon: <Boxes />, title: 'No variants found', description: filters.q ? 'Try another SKU, barcode or name.' : undefined }}
        toolbar={
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <SearchInput value={filters.q} onChange={(q) => setFilters({ q })} placeholder="SKU, barcode or product name" />
            <Segmented
              label="Stock status" size="sm" value={filters.status as 'ALL' | 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'} onChange={(status) => setFilters({ status })}
              options={[{ value: 'ALL', label: 'All' }, { value: 'IN_STOCK', label: 'In stock' }, { value: 'LOW_STOCK', label: 'Low' }, { value: 'OUT_OF_STOCK', label: 'Out' }]}
            />
          </div>
        }
        footer={<Pagination meta={meta} isValidating={isValidating} onPageChange={(p) => setFilters({ page: String(p) })} />}
      />

      {moving && (
        <Dialog open onOpenChange={(o) => !o && setMoving(null)} title="Record movement" description={<span>{moving.productName} · <span className="font-mono">{moving.sku}</span> · {moving.color} / {moving.size}</span>} size="md" modalLock>
          <MovementForm variant={moving} onCancel={() => setMoving(null)} onDone={() => { setMoving(null); void mutate(); }} />
        </Dialog>
      )}
      {history && <MovementHistorySheet row={history} onClose={() => setHistory(null)} />}
    </>
  );
}

function MovementHistorySheet({ row, onClose }: { row: InventoryRowDto; onClose: () => void }) {
  const [page, setPage] = React.useState(1);
  const { data, meta, error, isLoading, mutate } = useApi<InventoryMovementDto[]>('/inventory/movements', { variantId: row.variantId, page, pageSize: 20 });
  const cols = React.useMemo(() => movementColumns(false).filter((c) => c.id !== 'variant'), []);
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={`${row.productName} · ${row.color} / ${row.size}`} description={<span className="font-mono">{row.sku}</span>} width="lg">
      <div className="mb-4 grid grid-cols-3 gap-2 text-center">
        {[['On hand', row.onHand], ['Reserved', row.reserved], ['Available', row.available]].map(([l, v]) => (
          <div key={l} className="rounded-md border border-border p-2"><p className="text-xs text-muted">{l}</p><p className="tabular text-lg font-semibold">{formatNumber(v as number)}</p></div>
        ))}
      </div>
      <DataTable columns={cols} data={data} isLoading={isLoading} error={error} onRetry={() => void mutate()} getRowId={(m) => m.id} dense empty={{ title: 'No movements yet' }}
        footer={<Pagination meta={meta} onPageChange={setPage} />} />
    </Sheet>
  );
}
