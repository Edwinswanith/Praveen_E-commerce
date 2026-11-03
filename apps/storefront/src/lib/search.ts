import type { SearchResponse } from '@vyra/shared';
import { formatINR } from '@vyra/shared';

const MODE_LABEL: Record<SearchResponse['interpretation']['mode'], string> = {
  semantic: 'AI semantic search',
  keyword: 'Keyword search',
  visual: 'AI visual search',
  hybrid: 'AI visual + text search',
};

const GENDER_LABEL: Record<string, string> = {
  MEN: "men's",
  WOMEN: "women's",
  KIDS: "kids'",
  UNISEX: 'unisex',
};

function asNumber(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

function asStrings(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
  if (typeof v === 'string' && v)
    return v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

/** "Showing black items under ₹1,000 · AI semantic search" */
export function describeInterpretation(
  interp: SearchResponse['interpretation'] | null | undefined,
): string | null {
  if (!interp) return null;
  const f = interp.filters ?? {};
  const colors = asStrings(f.colors);
  const sizes = asStrings(f.sizes);
  const gender = typeof f.gender === 'string' ? GENDER_LABEL[f.gender] : undefined;
  const min = asNumber(f.minPrice);
  const max = asNumber(f.maxPrice);
  const subject = interp.semanticText?.trim() || 'items';
  const words = [colors.join(' & '), gender, subject].filter(Boolean).join(' ');
  let price = '';
  if (min !== undefined && max !== undefined)
    price = ` between ${formatINR(min)} and ${formatINR(max)}`;
  else if (max !== undefined) price = ` under ${formatINR(max)}`;
  else if (min !== undefined) price = ` above ${formatINR(min)}`;
  const size = sizes.length ? ` in size ${sizes.join(', ')}` : '';
  return `Showing ${words}${price}${size} · ${MODE_LABEL[interp.mode] ?? 'Search'}`;
}

export function isAiMode(mode: SearchResponse['interpretation']['mode'] | undefined): boolean {
  return mode === 'semantic' || mode === 'visual' || mode === 'hybrid';
}
