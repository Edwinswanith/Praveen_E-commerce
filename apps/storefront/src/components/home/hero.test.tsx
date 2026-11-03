import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Hero } from './hero';

describe('Hero price-drop tile', () => {
  it('advertises only the live, purchasable discount (rounded down)', () => {
    render(<Hero deals={{ maxDiscountPercent: 47, productCount: 30 }} />);
    expect(screen.getByTestId('deal-claim').textContent).toBe('45% off');
    expect(screen.getByText(/On 30 in-stock styles/)).toBeTruthy();
    expect(screen.getByTestId('deal-tile').getAttribute('href')).toBe('/products?sort=discount&inStock=true');
    expect(screen.queryByText(/60%/)).toBeNull();
  });
  it('makes no % claim without real deals or live data', () => {
    const { rerender } = render(<Hero deals={{ maxDiscountPercent: 5, productCount: 0 }} />);
    expect(screen.queryByTestId('deal-claim')).toBeNull();
    expect(screen.getByText('this week')).toBeTruthy();
    rerender(<Hero deals={null} />);
    expect(screen.queryByTestId('deal-claim')).toBeNull();
  });
});
