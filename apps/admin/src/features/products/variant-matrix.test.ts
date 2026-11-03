import { describe, expect, it } from 'vitest';
import { variantSchema } from '@vyra/shared';
import {
  applyToRows, deriveAxes, generateVariantMatrix, removeRow, toVariantPayload, type MatrixRow,
} from './variant-matrix';

const defaults = { mrp: '1999', price: '1499', costPrice: '600', weightGrams: '250', lowStockThreshold: '4' };

function existing(id: string, color: string, size: string, extra: Partial<MatrixRow> = {}): MatrixRow {
  return {
    key: id, id, color, colorHex: '#000000', size, mrp: '2499', price: '1999', costPrice: '800', weightGrams: '300',
    lowStockThreshold: '5', isActive: true, sku: `VY-TSH-00001-${color.slice(0, 3).toUpperCase()}-${size}`, barcode: '2000000000017',
    onHand: 12, reserved: 2, ...extra,
  };
}

describe('generateVariantMatrix', () => {
  it('builds the full colours × sizes cartesian product with defaults', () => {
    const rows = generateVariantMatrix(
      [{ name: 'Black', hex: '#111111' }, { name: 'Olive', hex: '#556b2f' }],
      ['S', 'M', 'L'],
      [],
      defaults,
    );
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => `${r.color}/${r.size}`)).toEqual(['Black/S', 'Black/M', 'Black/L', 'Olive/S', 'Olive/M', 'Olive/L']);
    expect(rows.every((r) => r.isActive && !r.id && r.mrp === '1999' && r.price === '1499' && r.weightGrams === '250')).toBe(true);
    expect(rows[3]?.colorHex).toBe('#556b2f');
    expect(new Set(rows.map((r) => r.key)).size).toBe(6);
  });

  it('ignores blank and duplicate (case-insensitive) colours and sizes', () => {
    const rows = generateVariantMatrix(
      [{ name: 'Black', hex: null }, { name: ' black ', hex: null }, { name: '  ', hex: null }],
      ['m', 'M', '', 'L'],
      [],
      defaults,
    );
    expect(rows.map((r) => `${r.color}/${r.size}`)).toEqual(['Black/m', 'Black/L']);
  });

  it('preserves existing variant ids, SKUs, prices and stock for matching combinations', () => {
    const prev = [existing('v1', 'Black', 'M'), existing('v2', 'Black', 'L', { price: '1799' })];
    const rows = generateVariantMatrix([{ name: 'black', hex: '#0a0a0a' }], ['M', 'L', 'XL'], prev, defaults);
    expect(rows).toHaveLength(3);
    const m = rows.find((r) => r.size === 'M');
    const l = rows.find((r) => r.size === 'L');
    expect(m).toMatchObject({ id: 'v1', key: 'v1', sku: prev[0]?.sku, mrp: '2499', onHand: 12, reserved: 2, colorHex: '#0a0a0a' });
    expect(l).toMatchObject({ id: 'v2', price: '1799' });
    const xl = rows.find((r) => r.size === 'XL');
    expect(xl?.id).toBeUndefined();
    expect(xl?.price).toBe('1499');
  });

  it('deactivates (never drops) persisted variants removed from the matrix, and drops unsaved ones', () => {
    const prev = [existing('v1', 'Black', 'M'), existing('v2', 'Navy', 'M'), { ...existing('tmp', 'Navy', 'L'), id: undefined, key: 'new:navy|L' }];
    const rows = generateVariantMatrix([{ name: 'Black', hex: null }], ['M'], prev, defaults);
    expect(rows.map((r) => [r.id ?? r.key, r.isActive])).toEqual([['v1', true], ['v2', false]]);
  });

  it('re-adding a colour reactivates its previously deactivated variant with the same id', () => {
    const prev = [existing('v1', 'Black', 'M'), existing('v2', 'Navy', 'M', { isActive: false })];
    const rows = generateVariantMatrix([{ name: 'Black', hex: null }, { name: 'Navy', hex: null }], ['M'], prev, defaults);
    expect(rows.find((r) => r.id === 'v2')?.isActive).toBe(true);
    expect(rows).toHaveLength(2);
  });

  it('is idempotent when regenerated from its own axes', () => {
    const first = generateVariantMatrix([{ name: 'Red', hex: '#ff0000' }], ['S', 'M'], [existing('v9', 'Red', 'S')], defaults);
    const { colours, sizes } = deriveAxes(first);
    expect(generateVariantMatrix(colours, sizes, first, defaults)).toEqual(first);
  });
});

describe('row helpers', () => {
  it('removeRow deactivates persisted rows and deletes new rows', () => {
    const rows = generateVariantMatrix([{ name: 'Black', hex: null }], ['M', 'L'], [existing('v1', 'Black', 'M')], defaults);
    const afterPersisted = removeRow(rows, 'v1');
    expect(afterPersisted.find((r) => r.id === 'v1')?.isActive).toBe(false);
    const newKey = rows.find((r) => !r.id)!.key;
    expect(removeRow(rows, newKey)).toHaveLength(1);
  });

  it('applyToRows only touches active rows by default', () => {
    const rows = [existing('v1', 'Black', 'M'), existing('v2', 'Black', 'L', { isActive: false })];
    const next = applyToRows(rows, 'price', '999');
    expect(next.map((r) => r.price)).toEqual(['999', '1999']);
  });

  it('toVariantPayload produces schema-valid variants, keeping ids and inactive persisted rows', () => {
    const rows = generateVariantMatrix([{ name: 'Black', hex: '#111111' }], ['M', 'L'], [existing('v1', 'Black', 'M'), existing('v2', 'White', 'M')], defaults);
    const payload = toVariantPayload(rows);
    expect(payload).toHaveLength(3);
    expect(payload[0]).toMatchObject({ id: 'v1', mrp: 2499, price: 1999, costPrice: 800, isActive: true });
    expect(payload[1]).not.toHaveProperty('id');
    expect(payload.find((p) => p.id === 'v2')?.isActive).toBe(false);
    for (const v of payload) expect(variantSchema.safeParse(v).success).toBe(true);
  });
});
