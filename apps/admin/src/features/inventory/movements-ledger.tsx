'use client';
import * as React from 'react';
import Link from 'next/link';
import type { InventoryMovementDto, InventoryRowDto } from '@vyra/shared';
import { InventoryMovementType } from '@vyra/shared';
import { Button } from '@vyra/ui';
import { ArrowLeft, History, X } from 'lucide-react';
import { useApi } from '@/lib/swr';
import { useUrlState } from '@/hooks/use-url-state';
import { humanize } from '@/lib/format';
import { DataTable } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import { PageHeader } from '@/components/ui/feedback';
import { Select } from '@/components/ui/controls';
import { movementColumns } from './movement-history';
import { VariantPicker } from './variant-picker';

export function MovementsLedger() {
  const [filters, setFilters] = useUrlState({ type: '', variantId: '', variantLabel: '', page: '1' });
  const { data, meta, error, isLoading, isValidating, mutate } = useApi<InventoryMovementDto[]>('/inventory/movements', {
    type: filters.type, variantId: filters.variantId, page: filters.page, pageSize: 30,
  });
  const columns = React.useMemo(() => movementColumns(true), []);
  return (
    <>
      <PageHeader
        back={<Link href="/inventory" className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-fg"><ArrowLeft className="size-3.5" /> Stock</Link>}
        title="Movement ledger"
        description="Append-only record of every stock change: receipts, adjustments, reservations, fulfilment and returns."
      />
      <DataTable
        columns={columns}
        data={data}
        isLoading={isLoading}
        error={error}
        onRetry={() => void mutate()}
        getRowId={(m) => m.id}
        dense
        empty={{ icon: <History />, title: 'No movements match these filters' }}
        toolbar={
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <Select aria-label="Movement type" value={filters.type} onChange={(e) => setFilters({ type: e.target.value })} className="md:w-52">
              <option value="">All types</option>
              {Object.values(InventoryMovementType).map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
            </Select>
            {filters.variantId ? (
              <span className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm">
                <span className="font-mono text-xs">{filters.variantLabel || filters.variantId}</span>
                <button type="button" aria-label="Clear variant filter" onClick={() => setFilters({ variantId: '', variantLabel: '' })} className="text-muted hover:text-fg"><X className="size-3.5" /></button>
              </span>
            ) : (
              <div className="md:w-96"><VariantPicker placeholder="Filter by variant (SKU, barcode, name)" onPick={(r: InventoryRowDto) => setFilters({ variantId: r.variantId, variantLabel: r.sku })} /></div>
            )}
            {(filters.type || filters.variantId) && <Button variant="ghost" size="sm" onClick={() => setFilters({ type: '', variantId: '', variantLabel: '' })}>Reset</Button>}
          </div>
        }
        footer={<Pagination meta={meta} isValidating={isValidating} onPageChange={(p) => setFilters({ page: String(p) })} />}
      />
    </>
  );
}
