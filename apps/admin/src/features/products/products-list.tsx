'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ColumnDef, RowSelectionState } from '@tanstack/react-table';
import { toast } from 'sonner';
import type { AdminProductRow, CategoryNode, ProductStatus } from '@vyra/shared';
import { Button } from '@vyra/ui';
import { Plus, Upload, Star, Shirt, Archive, Eye, EyeOff, StarOff } from 'lucide-react';
import { useApi } from '@/lib/swr';
import { api, errorMessage } from '@/lib/api';
import { useUrlState } from '@/hooks/use-url-state';
import { useAuth } from '@/features/auth/auth-context';
import { PERM } from '@/lib/permissions';
import { formatDate, formatINR, formatNumber } from '@/lib/format';
import { PRODUCT_STATUS_TONE } from '@/lib/status';
import { DataTable } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import { SearchInput } from '@/components/data-table/search-input';
import { PageHeader, StatusBadge } from '@/components/ui/feedback';
import { Segmented } from '@/components/ui/controls';
import { useConfirm } from '@/components/ui/confirm';
import { CategorySelect } from '@/features/categories/category-select';

type BulkAction = 'publish' | 'unpublish' | 'archive' | 'feature' | 'unfeature';

const columns: ColumnDef<AdminProductRow, unknown>[] = [
  {
    id: 'product',
    header: 'Product',
    cell: ({ row: { original: p } }) => (
      <div className="flex min-w-56 items-center gap-3">
        <span className="size-11 shrink-0 overflow-hidden rounded-md bg-surface-2 ring-1 ring-border">
          {p.imageUrl ? <img src={p.imageUrl} alt="" className="size-full object-cover" loading="lazy" /> : <Shirt className="m-3 size-5 text-subtle" aria-hidden />}
        </span>
        <span className="min-w-0">
          <Link href={`/products/${p.id}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5 truncate font-medium hover:underline">
            {p.name}
            {p.isFeatured && <Star className="size-3.5 shrink-0 fill-sun-400 text-sun-400" aria-label="Featured" />}
          </Link>
          <span className="block truncate text-xs text-muted">{p.brand}</span>
        </span>
      </div>
    ),
  },
  { header: 'Status', accessorKey: 'status', cell: ({ row }) => <StatusBadge value={row.original.status} tone={PRODUCT_STATUS_TONE[row.original.status]} /> },
  { header: 'Category', accessorKey: 'categoryName', cell: ({ row }) => <span className="whitespace-nowrap text-muted">{row.original.categoryName}</span> },
  { header: 'Variants', accessorKey: 'variantCount', meta: { align: 'right' }, cell: ({ row }) => formatNumber(row.original.variantCount) },
  {
    header: 'Stock', accessorKey: 'totalStock', meta: { align: 'right' },
    cell: ({ row }) => <span className={row.original.totalStock === 0 ? 'font-medium text-danger' : undefined}>{formatNumber(row.original.totalStock)}</span>,
  },
  {
    header: 'Price', id: 'price', meta: { align: 'right' },
    cell: ({ row: { original: p } }) => <span className="whitespace-nowrap">{p.minPrice === p.maxPrice ? formatINR(p.minPrice) : `${formatINR(p.minPrice)} – ${formatINR(p.maxPrice)}`}</span>,
  },
  { header: 'Updated', accessorKey: 'updatedAt', cell: ({ row }) => <span className="whitespace-nowrap text-muted">{formatDate(row.original.updatedAt)}</span> },
];

export function ProductsList() {
  const router = useRouter();
  const { can } = useAuth();
  const confirm = useConfirm();
  const [filters, setFilters] = useUrlState({ q: '', status: 'ALL', categoryId: '', page: '1' });
  const [selection, setSelection] = React.useState<RowSelectionState>({});
  const [bulkPending, setBulkPending] = React.useState(false);
  const { data: categories } = useApi<CategoryNode[]>('/categories');
  const { data, meta, error, isLoading, isValidating, mutate } = useApi<AdminProductRow[]>('/products', {
    q: filters.q, status: filters.status === 'ALL' ? undefined : filters.status, categoryId: filters.categoryId, page: filters.page, pageSize: 20,
  });
  const selectedIds = Object.keys(selection).filter((k) => selection[k]);
  React.useEffect(() => setSelection({}), [filters.q, filters.status, filters.categoryId, filters.page]);

  const runBulk = async (action: BulkAction) => {
    if (action === 'archive') {
      const ok = await confirm({ title: `Archive ${selectedIds.length} product(s)?`, description: 'Archived products are hidden from the storefront. You can restore them later.', confirmLabel: 'Archive', destructive: true });
      if (!ok) return;
    }
    setBulkPending(true);
    try {
      const res = await api.post<{ updated: number }>('/products/bulk', { ids: selectedIds, action });
      toast.success(`${formatNumber(res.updated)} product(s) updated`);
      setSelection({});
      void mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBulkPending(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Products"
        description="Manage catalog items, variants, media and publishing."
        actions={can(PERM.catalogWrite) && (
          <>
            <Button asChild variant="outline" size="sm"><Link href="/products/import"><Upload /> Import</Link></Button>
            <Button asChild size="sm"><Link href="/products/new"><Plus /> New product</Link></Button>
          </>
        )}
      />
      <DataTable
        columns={columns}
        data={data}
        isLoading={isLoading}
        error={error}
        onRetry={() => void mutate()}
        getRowId={(p) => p.id}
        onRowClick={(p) => router.push(`/products/${p.id}`)}
        rowSelection={selection}
        onRowSelectionChange={can(PERM.catalogPublish) ? setSelection : undefined}
        empty={{ icon: <Shirt />, title: filters.q || filters.status !== 'ALL' || filters.categoryId ? 'No products match these filters' : 'No products yet', description: 'Try a different search or create a product.' }}
        toolbar={
          selectedIds.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Bulk actions">
              <span className="mr-2 text-sm font-medium">{selectedIds.length} selected</span>
              <Button size="sm" variant="outline" disabled={bulkPending} onClick={() => void runBulk('publish')}><Eye /> Publish</Button>
              <Button size="sm" variant="outline" disabled={bulkPending} onClick={() => void runBulk('unpublish')}><EyeOff /> Unpublish</Button>
              <Button size="sm" variant="outline" disabled={bulkPending} onClick={() => void runBulk('feature')}><Star /> Feature</Button>
              <Button size="sm" variant="outline" disabled={bulkPending} onClick={() => void runBulk('unfeature')}><StarOff /> Unfeature</Button>
              <Button size="sm" variant="outline" disabled={bulkPending} onClick={() => void runBulk('archive')}><Archive /> Archive</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelection({})}>Clear</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              <SearchInput value={filters.q} onChange={(q) => setFilters({ q })} placeholder="Search name, SKU, brand" />
              <Segmented
                label="Status"
                size="sm"
                value={filters.status as 'ALL' | ProductStatus}
                onChange={(status) => setFilters({ status })}
                options={[{ value: 'ALL', label: 'All' }, { value: 'ACTIVE', label: 'Active' }, { value: 'DRAFT', label: 'Draft' }, { value: 'ARCHIVED', label: 'Archived' }]}
              />
              <CategorySelect tree={categories} placeholder="All categories" value={filters.categoryId} onChange={(e) => setFilters({ categoryId: e.target.value })} className="lg:w-56" aria-label="Category filter" />
            </div>
          )
        }
        footer={<Pagination meta={meta} isValidating={isValidating} onPageChange={(p) => setFilters({ page: String(p) })} />}
      />
    </>
  );
}
