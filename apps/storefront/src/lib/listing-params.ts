/** URL search-param helpers for listing pages: filters live in the URL. */
export type SearchParams = Record<string, string | string[] | undefined>;

export const LIST_FILTER_KEYS = [
  'category',
  'gender',
  'sizes',
  'colors',
  'brands',
  'fabric',
  'fit',
  'occasion',
  'minPrice',
  'maxPrice',
  'minRating',
  'inStock',
] as const;
export const LIST_KEYS = [...LIST_FILTER_KEYS, 'q', 'sort', 'page', 'pageSize'] as const;

export const SORT_OPTIONS = [
  { value: 'relevance', label: 'Recommended' },
  { value: 'newest', label: "What's new" },
  { value: 'popularity', label: 'Popularity' },
  { value: 'discount', label: 'Better discount' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'rating', label: 'Customer rating' },
] as const;

export function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Picks the known listing params out of Next's searchParams into a flat string map. */
export function pickListParams(
  sp: SearchParams,
  allowed: readonly string[] = LIST_KEYS,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of allowed) {
    const v = first(sp[k]);
    if (v !== undefined && v !== '') out[k] = v;
  }
  return out;
}

export function splitList(v: string | null | undefined): string[] {
  return v
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}

/** Returns a new query string with `key` set (or removed when value is empty); always resets page. */
export function withParam(current: URLSearchParams, key: string, value: string | null): string {
  const next = new URLSearchParams(current);
  if (value === null || value === '') next.delete(key);
  else next.set(key, value);
  if (key !== 'page') next.delete('page');
  return next.toString();
}

/** Toggles a value inside a comma-separated list param. */
export function toggleListValue(current: URLSearchParams, key: string, value: string): string {
  const list = splitList(current.get(key));
  const nextList = list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
  return withParam(current, key, nextList.join(','));
}

export function pageHref(pathname: string, current: URLSearchParams, page: number): string {
  const next = new URLSearchParams(current);
  if (page <= 1) next.delete('page');
  else next.set('page', String(page));
  const qs = next.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** Compact page list with ellipses: [1, '…', 4, 5, 6, '…', 20]. */
export function pageWindow(page: number, totalPages: number): (number | '…')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const pages: (number | '…')[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) pages.push('…');
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < totalPages - 1) pages.push('…');
  pages.push(totalPages);
  return pages;
}
