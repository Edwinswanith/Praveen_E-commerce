import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { formatINR, formatIST } from '@vyra/shared';
import { PdpPrice } from './sale-price-note';

const campaign = { id: 'c1', name: 'Festive Edit Sale', slug: 'festive-edit', endsAt: '2026-11-13T11:00:00.000Z' };

function struck(container: HTMLElement) {
  return [...container.querySelectorAll('.line-through')].map((e) => e.textContent);
}

describe('<PdpPrice />', () => {
  it('strikes only the MRP and shows the regular price as plain text', () => {
    const { container } = render(<PdpPrice price={599} mrp={1299} basePrice={799} campaign={campaign} />);
    expect(struck(container)).toEqual([`MRP ${formatINR(1299)}`]);
    expect(screen.getByText('(54% OFF)')).toBeInTheDocument();
    const regular = screen.getByTestId('regular-price');
    expect(regular).toHaveTextContent(`Regular price ${formatINR(799)}`);
    expect(regular.closest('.line-through')).toBeNull();
    expect(regular.querySelector('.line-through')).toBeNull();
    expect(screen.getByText('Festive Edit Sale price')).toBeInTheDocument();
    expect(screen.getByText(`Sale ends ${formatIST(campaign.endsAt)}`)).toBeInTheDocument();
  });

  it('shows no regular-price text or sale tag without a sale', () => {
    const { container } = render(<PdpPrice price={799} mrp={1299} basePrice={799} campaign={null} />);
    expect(screen.queryByTestId('regular-price')).toBeNull();
    expect(screen.queryByTestId('campaign-tag')).toBeNull();
    expect(struck(container)).toEqual([`MRP ${formatINR(1299)}`]);
  });

  it('never shows a regular price below the sale price', () => {
    render(<PdpPrice price={799} mrp={1299} basePrice={699} campaign={campaign} />);
    expect(screen.queryByTestId('regular-price')).toBeNull();
  });
});
