import type { AdminVariantDto } from '@vyra/shared';

/** A colour axis value. */
export interface ColourOption { name: string; hex: string | null }

/** Editable variant row. Numeric fields are kept as strings while editing. */
export interface MatrixRow {
  /** Stable client key (the server id for existing variants). */
  key: string;
  id?: string;
  color: string;
  colorHex: string | null;
  size: string;
  mrp: string;
  price: string;
  costPrice: string;
  weightGrams: string;
  lowStockThreshold: string;
  isActive: boolean;
  /** Server-generated, read-only. */
  sku?: string;
  barcode?: string | null;
  onHand?: number;
  reserved?: number;
}

export type MatrixDefaults = Pick<MatrixRow, 'mrp' | 'price' | 'costPrice' | 'weightGrams' | 'lowStockThreshold'>;
export type EditableField = keyof MatrixDefaults;

export const DEFAULT_MATRIX_VALUES: MatrixDefaults = { mrp: '', price: '', costPrice: '', weightGrams: '300', lowStockThreshold: '5' };

export const normColour = (c: string) => c.trim().toLowerCase();
export const normSize = (s: string) => s.trim().toUpperCase();
export const comboKey = (color: string, size: string) => `${normColour(color)}|${normSize(size)}`;

function uniqueBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = key(i);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Builds the variant list for colours × sizes.
 *  - Existing rows matching a combination are kept as-is (id, SKU, prices, stock) and re-activated.
 *  - New combinations get fresh rows with `defaults`.
 *  - Existing server variants (with id) no longer in the matrix are kept but deactivated
 *    (the API never deletes variants); unsaved rows that fall out are dropped.
 * Output order: colour order, then size order; deactivated rows last.
 */
export function generateVariantMatrix(
  colours: ColourOption[],
  sizes: string[],
  existing: MatrixRow[],
  defaults: MatrixDefaults = DEFAULT_MATRIX_VALUES,
): MatrixRow[] {
  const cols = uniqueBy(colours.filter((c) => c.name.trim()), (c) => normColour(c.name));
  const szs = uniqueBy(sizes.map((s) => s.trim()).filter(Boolean), normSize);
  const byCombo = new Map<string, MatrixRow>();
  for (const row of existing) {
    const k = comboKey(row.color, row.size);
    // Prefer persisted rows when duplicates exist.
    if (!byCombo.has(k) || (row.id && !byCombo.get(k)?.id)) byCombo.set(k, row);
  }

  const used = new Set<string>();
  const out: MatrixRow[] = [];
  for (const colour of cols) {
    for (const size of szs) {
      const k = comboKey(colour.name, size);
      used.add(k);
      const prev = byCombo.get(k);
      if (prev) {
        out.push({ ...prev, colorHex: colour.hex ?? prev.colorHex, isActive: true });
      } else {
        out.push({
          key: `new:${k}`,
          color: colour.name.trim(),
          colorHex: colour.hex,
          size: size.trim(),
          ...defaults,
          isActive: true,
        });
      }
    }
  }
  for (const row of existing) {
    const k = comboKey(row.color, row.size);
    if (used.has(k)) continue;
    if (row.id) {
      used.add(k);
      out.push({ ...row, isActive: false });
    }
  }
  return out;
}

/** Derives the colour and size axes from rows (active ones only), in first-seen order. */
export function deriveAxes(rows: MatrixRow[]): { colours: ColourOption[]; sizes: string[] } {
  const active = rows.filter((r) => r.isActive);
  const colours = uniqueBy(active.map((r) => ({ name: r.color, hex: r.colorHex })), (c) => normColour(c.name));
  const sizes = uniqueBy(active.map((r) => r.size), normSize);
  return { colours, sizes };
}

export function rowsFromVariants(variants: AdminVariantDto[]): MatrixRow[] {
  return variants.map((v) => ({
    key: v.id,
    id: v.id,
    color: v.color,
    colorHex: v.colorHex,
    size: v.size,
    mrp: String(v.mrp),
    price: String(v.price),
    costPrice: v.costPrice === null || v.costPrice === undefined ? '' : String(v.costPrice),
    weightGrams: String(v.weightGrams),
    lowStockThreshold: String(v.lowStockThreshold),
    isActive: v.isActive,
    sku: v.sku,
    barcode: v.barcode ?? v.barcodes?.[0]?.value ?? null,
    onHand: v.onHand,
    reserved: v.reserved,
  }));
}

/** Sets `field` on every row matching `predicate` (default: active rows). */
export function applyToRows(rows: MatrixRow[], field: EditableField, value: string, predicate: (r: MatrixRow) => boolean = (r) => r.isActive): MatrixRow[] {
  return rows.map((r) => (predicate(r) ? { ...r, [field]: value } : r));
}

/** Removes a row: persisted variants are deactivated, unsaved rows dropped. */
export function removeRow(rows: MatrixRow[], key: string): MatrixRow[] {
  return rows.flatMap((r) => {
    if (r.key !== key) return [r];
    return r.id ? [{ ...r, isActive: false }] : [];
  });
}

const toNum = (s: string) => (s.trim() === '' ? NaN : Number(s));

/** Converts rows to the API `variants` payload (validated afterwards with variantSchema). */
export function toVariantPayload(rows: MatrixRow[]) {
  return rows
    .filter((r) => r.id || r.isActive)
    .map((r) => ({
      ...(r.id ? { id: r.id } : {}),
      color: r.color.trim(),
      colorHex: r.colorHex,
      size: r.size.trim(),
      mrp: toNum(r.mrp),
      price: toNum(r.price),
      costPrice: r.costPrice.trim() === '' ? null : Number(r.costPrice),
      weightGrams: r.weightGrams.trim() === '' ? 300 : Number(r.weightGrams),
      lowStockThreshold: r.lowStockThreshold.trim() === '' ? 5 : Number(r.lowStockThreshold),
      isActive: r.isActive,
    }));
}

/** Applies per-cell removals on top of a generated matrix (persisted → inactive, new → dropped). */
export function applyExclusions(rows: MatrixRow[], excluded: Set<string>): MatrixRow[] {
  if (!excluded.size) return rows;
  return rows.flatMap((r) => {
    if (!excluded.has(comboKey(r.color, r.size))) return [r];
    return r.id ? [{ ...r, isActive: false }] : [];
  });
}
