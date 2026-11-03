import { SearchX } from 'lucide-react';
import type { ProductCardDto, ProductFacets, PageMeta } from '@vyra/shared';
import { Alert, EmptyState } from '@vyra/ui';
import { ProductGrid } from '../product/product-grid';
import { ListingResults, ListingShell } from './listing-shell';
import { FilterPanel } from './filter-panel';
import { ActiveFilters, MobileFilterBar, SortSelect } from './toolbar';
import { Pagination } from './pagination';

export interface ListingViewProps {
  header: React.ReactNode;
  products: ProductCardDto[];
  meta: PageMeta | null;
  facets: ProductFacets | null;
  showCategoryFacet?: boolean;
  error?: string | null;
  emptyAction?: React.ReactNode;
  /** Rendered above the toolbar (e.g. search interpretation line). */
  note?: React.ReactNode;
}

export function ListingView({
  header,
  products,
  meta,
  facets,
  showCategoryFacet = true,
  error,
  emptyAction,
  note,
}: ListingViewProps) {
  const total = meta?.total ?? 0;
  const categoryNames = Object.fromEntries((facets?.categories ?? []).map((c) => [c.slug, c.name]));
  return (
    <ListingShell>
      <div className="pb-4 pt-4 sm:pt-6">{header}</div>
      <div className="lg:grid lg:grid-cols-[240px_1fr] lg:gap-8">
        {facets && (
          <aside aria-label="Filters" className="hidden lg:block">
            <div className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto pr-2">
              <p className="border-b border-border pb-3 text-sm font-bold uppercase tracking-wider">
                Filters
              </p>
              <FilterPanel facets={facets} showCategory={showCategoryFacet} />
            </div>
          </aside>
        )}
        <div className={facets ? undefined : 'lg:col-span-2'}>
          {note}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
            <p className="text-sm text-muted" aria-live="polite">
              <strong className="text-fg">{total.toLocaleString('en-IN')}</strong>{' '}
              {total === 1 ? 'item' : 'items'}
            </p>
            <SortSelect className="hidden lg:flex" />
          </div>
          <div className="mt-3">
            <ActiveFilters categoryNames={categoryNames} />
          </div>
          <ListingResults className="mt-5">
            {error ? (
              <Alert tone="danger" title="We couldn’t load products">
                {error}
              </Alert>
            ) : products.length === 0 ? (
              <EmptyState
                icon={<SearchX />}
                title="No matching styles"
                description="Try removing a filter or searching for something else."
                action={emptyAction}
              />
            ) : (
              <ProductGrid products={products} />
            )}
          </ListingResults>
          {meta && <Pagination page={meta.page} totalPages={meta.totalPages} />}
          <MobileFilterBar facets={facets} showCategory={showCategoryFacet} total={total} />
        </div>
      </div>
    </ListingShell>
  );
}
