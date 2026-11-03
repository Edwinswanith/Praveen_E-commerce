import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { VariantDto } from '@vyra/shared';
import { VariantSelector } from './variant-selector';
import {
  initialSelection,
  resolveVariant,
  selectColor,
  sizeOptions,
  type Selection,
} from '@/lib/variants';

function v(
  id: string,
  color: string,
  size: string,
  available: number,
  extra: Partial<VariantDto> = {},
): VariantDto {
  return {
    id,
    sku: `SKU-${id}`,
    color,
    colorHex: color === 'Black' ? '#000000' : '#1e3a8a',
    size,
    mrp: 1499,
    price: 999,
    basePrice: 999,
    campaign: null,
    discountPercent: 33,
    available,
    inStock: available > 0,
    isActive: true,
    barcode: null,
    ...extra,
  };
}

// Black: S (3 left), M (out of stock), L (10). Navy: M (5), XL (2). Navy S / L don't exist. Black XL inactive.
const variants: VariantDto[] = [
  v('b-s', 'Black', 'S', 3),
  v('b-m', 'Black', 'M', 0),
  v('b-l', 'Black', 'L', 10),
  v('b-xl', 'Black', 'XL', 4, { isActive: false }),
  v('n-m', 'Navy', 'M', 5),
  v('n-xl', 'Navy', 'XL', 2),
];

function Harness({ onSelect }: { onSelect?: (s: Selection) => void }) {
  const [sel, setSel] = React.useState<Selection>(() => initialSelection(variants));
  const variant = resolveVariant(variants, sel.color, sel.size);
  return (
    <>
      <VariantSelector
        variants={variants}
        selection={sel}
        onChange={(s) => {
          setSel(s);
          onSelect?.(s);
        }}
      />
      <output data-testid="variant">{variant?.id ?? 'none'}</output>
    </>
  );
}

describe('variant logic', () => {
  it('lists sizes in size order and marks state per colour', () => {
    const black = sizeOptions(variants, 'Black').map((s) => `${s.size}:${s.state}`);
    // XL only exists (active) for Navy, so for Black it is unavailable; inactive Black XL is ignored.
    expect(black).toEqual(['S:available', 'M:out-of-stock', 'L:available', 'XL:unavailable']);
    const navy = sizeOptions(variants, 'Navy').map((s) => `${s.size}:${s.state}`);
    expect(navy).toEqual(['S:unavailable', 'M:available', 'L:unavailable', 'XL:available']);
  });

  it('resolves only sellable combinations to exactly one variant', () => {
    expect(resolveVariant(variants, 'Black', 'L')?.id).toBe('b-l');
    expect(resolveVariant(variants, 'Black', 'M')).toBeNull(); // out of stock
    expect(resolveVariant(variants, 'Navy', 'S')).toBeNull(); // nonexistent
    expect(resolveVariant(variants, 'Black', 'XL')).toBeNull(); // inactive
  });

  it('drops the size when switching to a colour where it is not sellable', () => {
    expect(selectColor(variants, { color: 'Black', size: 'L' }, 'Navy')).toEqual({
      color: 'Navy',
      size: null,
    });
    expect(selectColor(variants, { color: 'Navy', size: 'XL' }, 'Black')).toEqual({
      color: 'Black',
      size: null,
    });
  });
});

describe('<VariantSelector />', () => {
  it('disables out-of-stock and nonexistent sizes and selects a single variant', () => {
    render(<Harness />);
    // Default colour is the first one with stock (Black), no size preselected.
    expect(screen.getByRole('radio', { name: 'Black' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('variant')).toHaveTextContent('none');

    expect(screen.getByRole('radio', { name: /^M, out of stock/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /^XL, not available in this colour/ })).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: 'L' }));
    expect(screen.getByTestId('variant')).toHaveTextContent('b-l');

    // Switch colour: L doesn't exist in Navy, so the selection resets and L becomes disabled.
    fireEvent.click(screen.getByRole('radio', { name: 'Navy' }));
    expect(screen.getByTestId('variant')).toHaveTextContent('none');
    expect(screen.getByRole('radio', { name: /^L, not available/ })).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: 'XL, only 2 left' }));
    expect(screen.getByTestId('variant')).toHaveTextContent('n-xl');
  });

  it('ignores clicks on disabled sizes', () => {
    const calls: Selection[] = [];
    render(<Harness onSelect={(s) => calls.push(s)} />);
    fireEvent.click(screen.getByRole('radio', { name: /^M, out of stock/ }));
    expect(calls).toHaveLength(0);
    expect(screen.getByTestId('variant')).toHaveTextContent('none');
  });
});

describe('selectionForVariant (QR tag deep link)', () => {
  it('preselects the scanned colour and size, but never a sold-out size', async () => {
    const { selectionForVariant } = await import('@/lib/variants');
    const mk = (id: string, color: string, size: string, inStock: boolean) => ({ id, sku: id, color, colorHex: null, size, mrp: 100, price: 80, basePrice: 80, campaign: null, discountPercent: 20, available: inStock ? 3 : 0, inStock, isActive: true, barcode: null });
    const vs = [mk('a', 'Black', 'M', true), mk('b', 'White', 'L', true), mk('c', 'White', 'XL', false)];
    expect(selectionForVariant(vs, 'b')).toEqual({ color: 'White', size: 'L' });
    expect(selectionForVariant(vs, 'c')).toEqual({ color: 'White', size: null });
    expect(selectionForVariant(vs, 'nope').color).toBe('Black');
  });
});
