'use client';

import * as React from 'react';
import { ArrowUpDown, SlidersHorizontal, X } from 'lucide-react';
import type { ProductFacets } from '@vyra/shared';
import { formatINR } from '@vyra/shared';
import { Button, cn } from '@vyra/ui';
import {
  LIST_FILTER_KEYS,
  SORT_OPTIONS,
  splitList,
  toggleListValue,
  withParam,
} from '@/lib/listing-params';
import { NativeSelect } from '../ui/select';
import { Sheet } from '../ui/dialog';
import { FilterPanel } from './filter-panel';
import { useListingNav } from './listing-shell';

export function SortSelect({
  className,
  options = SORT_OPTIONS,
}: {
  className?: string;
  options?: readonly { value: string; label: string }[];
}) {
  const { params, navigate } = useListingNav();
  return (
    <label className={cn('flex items-center gap-2 text-sm', className)}>
      <span className="whitespace-nowrap text-muted">Sort by</span>
      <NativeSelect
        value={params.get('sort') ?? 'relevance'}
        onChange={(e) =>
          navigate(
            withParam(params, 'sort', e.target.value === 'relevance' ? null : e.target.value),
          )
        }
        className="h-9 min-w-44 font-semibold"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}

const LIST_LABELS: Record<string, string> = {
  sizes: 'Size',
  colors: 'Colour',
  brands: 'Brand',
  fabric: 'Fabric',
  fit: 'Fit',
  occasion: 'Occasion',
};

/** Removable chips for every active filter. */
export function ActiveFilters({ categoryNames = {} }: { categoryNames?: Record<string, string> }) {
  const { params, navigate } = useListingNav();
  const chips: { key: string; label: string; remove: () => void }[] = [];
  const cat = params.get('category');
  if (cat)
    chips.push({
      key: 'category',
      label: categoryNames[cat] ?? cat,
      remove: () => navigate(withParam(params, 'category', null)),
    });
  for (const k of Object.keys(LIST_LABELS)) {
    for (const v of splitList(params.get(k)))
      chips.push({
        key: `${k}-${v}`,
        label: v,
        remove: () => navigate(toggleListValue(params, k, v)),
      });
  }
  const min = params.get('minPrice');
  const max = params.get('maxPrice');
  if (min || max) {
    chips.push({
      key: 'price',
      label: `${min ? formatINR(Number(min)) : '₹0'} – ${max ? formatINR(Number(max)) : 'any'}`,
      remove: () => {
        const n = new URLSearchParams(params);
        n.delete('minPrice');
        n.delete('maxPrice');
        n.delete('page');
        navigate(n.toString());
      },
    });
  }
  if (params.get('minRating'))
    chips.push({
      key: 'rating',
      label: `${params.get('minRating')}★ & above`,
      remove: () => navigate(withParam(params, 'minRating', null)),
    });
  if (params.get('inStock') === 'true')
    chips.push({
      key: 'stock',
      label: 'In stock',
      remove: () => navigate(withParam(params, 'inStock', null)),
    });
  if (chips.length === 0) return null;
  const clearAll = () => {
    const n = new URLSearchParams(params);
    for (const k of LIST_FILTER_KEYS) n.delete(k);
    n.delete('page');
    navigate(n.toString());
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={c.remove}
          className="inline-flex items-center gap-1 rounded-full border border-border-strong px-3 py-1 text-xs font-medium hover:border-fg"
          aria-label={`Remove filter ${c.label}`}
        >
          {c.label}
          <X className="size-3" aria-hidden />
        </button>
      ))}
      <button
        type="button"
        onClick={clearAll}
        className="text-xs font-bold uppercase tracking-wide text-brand-600 hover:underline"
      >
        Clear all
      </button>
    </div>
  );
}

/** Mobile sticky bar: Sort + Filter buttons opening bottom sheets. */
export function MobileFilterBar({
  facets,
  showCategory,
  total,
}: {
  facets: ProductFacets | null;
  showCategory?: boolean;
  total: number;
}) {
  const { params, navigate } = useListingNav();
  const [filters, setFilters] = React.useState(false);
  const [sort, setSort] = React.useState(false);
  const activeCount = LIST_FILTER_KEYS.reduce((n, k) => n + (params.get(k) ? 1 : 0), 0);
  const current = params.get('sort') ?? 'relevance';
  return (
    <>
      <div
        className={cn(
          'sticky bottom-0 z-30 -mx-4 mt-4 grid border-t border-border bg-bg pb-[env(safe-area-inset-bottom)] lg:hidden',
          facets ? 'grid-cols-2' : 'grid-cols-1',
        )}
      >
        <button
          type="button"
          onClick={() => setSort(true)}
          className="flex h-12 items-center justify-center gap-2 text-sm font-bold uppercase tracking-wide"
        >
          <ArrowUpDown className="size-4" aria-hidden /> Sort
        </button>
        {facets && (
          <button
            type="button"
            onClick={() => setFilters(true)}
            className="flex h-12 items-center justify-center gap-2 border-l border-border text-sm font-bold uppercase tracking-wide"
          >
            <SlidersHorizontal className="size-4" aria-hidden /> Filter
            {activeCount > 0 && (
              <span className="rounded-full bg-brand-500 px-1.5 text-[10px] text-white">
                {activeCount}
              </span>
            )}
          </button>
        )}
      </div>
      <Sheet open={sort} onOpenChange={setSort} side="bottom" title="Sort by">
        <ul className="py-2" role="radiogroup" aria-label="Sort by">
          {SORT_OPTIONS.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                role="radio"
                aria-checked={current === o.value}
                onClick={() => {
                  navigate(withParam(params, 'sort', o.value === 'relevance' ? null : o.value));
                  setSort(false);
                }}
                className={cn(
                  'w-full px-5 py-3 text-left text-sm',
                  current === o.value && 'font-bold text-brand-600',
                )}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
      {facets && (
        <Sheet
          open={filters}
          onOpenChange={setFilters}
          side="bottom"
          title="Filters"
          footer={
            <Button block onClick={() => setFilters(false)}>
              Show {total} results
            </Button>
          }
        >
          <div className="px-5 pb-4">
            <FilterPanel facets={facets} showCategory={showCategory} />
          </div>
        </Sheet>
      )}
    </>
  );
}
