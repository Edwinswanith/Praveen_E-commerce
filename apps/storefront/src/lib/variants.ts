import type { VariantDto } from '@vyra/shared';

const SIZE_ORDER = [
  'XXS',
  'XS',
  'S',
  'M',
  'L',
  'XL',
  'XXL',
  '2XL',
  '3XL',
  'XXXL',
  '4XL',
  '5XL',
  'FREE',
  'FREE SIZE',
  'ONE SIZE',
];

/** Sort sizes in a human order: letter sizes, then numeric (28, 30…), then kids ages (2-3Y), then anything else. */
export function compareSizes(a: string, b: string): number {
  const ua = a.toUpperCase();
  const ub = b.toUpperCase();
  const ia = SIZE_ORDER.indexOf(ua);
  const ib = SIZE_ORDER.indexOf(ub);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  const na = Number.parseFloat(ua);
  const nb = Number.parseFloat(ub);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  if (!Number.isNaN(na)) return -1;
  if (!Number.isNaN(nb)) return 1;
  return ua.localeCompare(ub);
}

export interface ColorOption {
  name: string;
  hex: string | null;
  /** At least one in-stock size exists for this colour. */
  inStock: boolean;
}

export type SizeState = 'available' | 'out-of-stock' | 'unavailable';

export interface SizeOption {
  size: string;
  state: SizeState;
  variant: VariantDto | null;
}

function sellable(v: VariantDto): boolean {
  return v.isActive && v.inStock && v.available > 0;
}

/** Only active variants are real options. */
export function activeVariants(variants: VariantDto[]): VariantDto[] {
  return variants.filter((v) => v.isActive);
}

export function colorOptions(variants: VariantDto[]): ColorOption[] {
  const map = new Map<string, ColorOption>();
  for (const v of activeVariants(variants)) {
    const existing = map.get(v.color);
    if (existing) {
      existing.inStock = existing.inStock || sellable(v);
      if (!existing.hex && v.colorHex) existing.hex = v.colorHex;
    } else {
      map.set(v.color, { name: v.color, hex: v.colorHex, inStock: sellable(v) });
    }
  }
  return [...map.values()];
}

/** Every size the product comes in (any colour), each marked for the chosen colour. */
export function sizeOptions(variants: VariantDto[], color: string | null): SizeOption[] {
  const active = activeVariants(variants);
  const sizes = [...new Set(active.map((v) => v.size))].sort(compareSizes);
  return sizes.map((size) => {
    const variant = color
      ? (active.find((v) => v.color === color && v.size === size) ?? null)
      : null;
    if (!variant) return { size, state: 'unavailable' as const, variant: null };
    return {
      size,
      state: sellable(variant) ? ('available' as const) : ('out-of-stock' as const),
      variant,
    };
  });
}

/** The single purchasable variant for a colour+size, or null if that combination can't be bought. */
export function resolveVariant(
  variants: VariantDto[],
  color: string | null,
  size: string | null,
): VariantDto | null {
  if (!color || !size) return null;
  const v = activeVariants(variants).find((x) => x.color === color && x.size === size);
  return v && sellable(v) ? v : null;
}

export interface Selection {
  color: string | null;
  size: string | null;
}

/** Default selection: first colour with stock; size pre-selected only when there is exactly one sellable size. */
export function initialSelection(
  variants: VariantDto[],
  preferredColor?: string | null,
): Selection {
  const colors = colorOptions(variants);
  const color =
    (preferredColor &&
      colors.find((c) => c.name.toLowerCase() === preferredColor.toLowerCase())?.name) ||
    colors.find((c) => c.inStock)?.name ||
    colors[0]?.name ||
    null;
  const sizes = sizeOptions(variants, color);
  const sellableSizes = sizes.filter((s) => s.state === 'available');
  return {
    color,
    size: sizes.length === 1 && sellableSizes.length === 1 ? sellableSizes[0]!.size : null,
  };
}

/** Changing colour keeps the size only if it's still sellable in the new colour. */
export function selectColor(variants: VariantDto[], current: Selection, color: string): Selection {
  const keep = current.size && resolveVariant(variants, color, current.size) ? current.size : null;
  return { color, size: keep };
}

/** Selecting a size is a no-op unless that combination is sellable. */
export function selectSize(variants: VariantDto[], current: Selection, size: string): Selection {
  return resolveVariant(variants, current.color, size) ? { ...current, size } : current;
}

export function stockMessage(v: VariantDto | null, lowStockAt = 5): string | null {
  if (!v) return null;
  if (!v.inStock || v.available <= 0) return 'Out of stock';
  if (v.available <= lowStockAt) return `Only ${v.available} left`;
  return null;
}
