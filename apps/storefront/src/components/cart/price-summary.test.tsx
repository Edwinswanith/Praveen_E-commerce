import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { CartTotalsDto } from '@vyra/shared';
import { formatINR } from '@vyra/shared';
import { FreeShippingProgress, PriceSummary } from './price-summary';

const totals: CartTotalsDto = {
  mrpTotal: 4997,
  subtotal: 2997,
  productDiscount: 2000,
  couponDiscount: 300,
  promotionDiscount: 0,
  promotionName: null,
  campaignSavings: 0,
  offerNote: null,
  prepaidDiscount: 0,
  prepaidSavings: 0,
  shippingFee: 0,
  codFee: 0,
  taxTotal: 128.43,
  grandTotal: 2697,
  codAvailable: true,
  codUnavailableReason: null,
  freeShippingThreshold: 999,
};

function row(label: RegExp) {
  const dt = screen.getByText(label);
  return dt.closest('div')!;
}

describe('<PriceSummary />', () => {
  it('renders every line from the server totals', () => {
    render(<PriceSummary totals={totals} itemCount={3} couponCode="VIBE10" />);
    expect(screen.getByText('Price details (3 items)')).toBeInTheDocument();
    expect(within(row(/^Total MRP$/)).getByText(formatINR(4997))).toBeInTheDocument();
    expect(within(row(/^Discount on MRP$/)).getByText(`−${formatINR(2000)}`)).toBeInTheDocument();
    expect(
      within(row(/Coupon discount \(VIBE10\)/)).getByText(`−${formatINR(300)}`),
    ).toBeInTheDocument();
    expect(within(row(/^Shipping fee$/)).getByText('FREE')).toBeInTheDocument();
    expect(screen.getByTestId('grand-total')).toHaveTextContent(formatINR(2697));
    expect(screen.getByText(`Inclusive of GST ${formatINR(128.43)}`)).toBeInTheDocument();
    expect(screen.getByText(`You’re saving ${formatINR(2300)} on this order`)).toBeInTheDocument();
  });

  it('shows shipping and COD fees and hides zero discounts', () => {
    render(
      <PriceSummary
        totals={{
          ...totals,
          productDiscount: 0,
          couponDiscount: 0,
          mrpTotal: 499,
          subtotal: 499,
          shippingFee: 79,
          codFee: 49,
          grandTotal: 627,
        }}
        itemCount={1}
      />,
    );
    expect(screen.getByText('Price details (1 item)')).toBeInTheDocument();
    expect(screen.queryByText(/Discount on MRP/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Coupon discount/)).not.toBeInTheDocument();
    expect(within(row(/^Shipping fee$/)).getByText(formatINR(79))).toBeInTheDocument();
    expect(within(row(/Cash on delivery fee/)).getByText(formatINR(49))).toBeInTheDocument();
    expect(screen.queryByText(/You’re saving/)).not.toBeInTheDocument();
  });
});

describe('<PriceSummary /> prepaid discount', () => {
  it('shows the prepaid discount line and counts it in savings', () => {
    render(<PriceSummary totals={{ ...totals, prepaidDiscount: 50 }} itemCount={3} />);
    expect(within(row(/^Prepaid discount$/)).getByText(`−${formatINR(50)}`)).toBeInTheDocument();
    expect(screen.getByText(`You’re saving ${formatINR(2350)} on this order`)).toBeInTheDocument();
  });

  it('hides the line when zero', () => {
    render(<PriceSummary totals={totals} itemCount={3} />);
    expect(screen.queryByText(/Prepaid discount/)).not.toBeInTheDocument();
  });
});

describe('<PriceSummary /> festival offers', () => {
  const sale: CartTotalsDto = {
    ...totals,
    mrpTotal: 3198,
    subtotal: 1338,
    productDiscount: 1860,
    campaignSavings: 460,
    promotionDiscount: 133,
    promotionName: 'Buy 2, extra 10% off',
    couponDiscount: 0,
    grandTotal: 1205,
  };

  it('shows sale savings as part of the MRP discount, and the bundle as its own line', () => {
    render(<PriceSummary totals={sale} itemCount={2} />);
    expect(within(row(/^Discount on MRP$/)).getByText(`−${formatINR(1860)}`)).toBeInTheDocument();
    expect(screen.getByTestId('sale-savings')).toHaveTextContent(formatINR(460));
    // Included in the MRP discount, so it is not deducted again.
    expect(screen.getByTestId('sale-savings').textContent).not.toContain('−');
    expect(
      within(row(/^Bundle: Buy 2, extra 10% off$/)).getByText(`−${formatINR(133)}`),
    ).toBeInTheDocument();
    expect(screen.getByText(`You’re saving ${formatINR(1860 + 133)} on this order`)).toBeInTheDocument();
  });

  it('hides sale savings and bundle lines when zero', () => {
    render(<PriceSummary totals={totals} itemCount={3} />);
    expect(screen.queryByTestId('sale-savings')).toBeNull();
    expect(screen.queryByText(/^Bundle/)).toBeNull();
    expect(screen.queryByTestId('offer-note')).toBeNull();
  });

  it('labels an automatically applied coupon', () => {
    const { rerender } = render(
      <PriceSummary totals={totals} itemCount={3} couponCode="FESTIVE5" couponAutoApplied />,
    );
    expect(within(row(/Coupon discount \(FESTIVE5\)/)).getByText('Applied automatically')).toBeInTheDocument();
    rerender(<PriceSummary totals={totals} itemCount={3} couponCode="VIBE10" />);
    expect(screen.queryByText('Applied automatically')).toBeNull();
  });

  it('shows the offer note from the server', () => {
    const note = 'VIBE10 can\'t be combined with “Buy 2, extra 10% off”. We kept the better offer.';
    render(<PriceSummary totals={{ ...sale, offerNote: note }} itemCount={2} />);
    expect(screen.getByTestId('offer-note')).toHaveTextContent(note);
  });
});

describe('<FreeShippingProgress />', () => {
  it('shows the amount left to the free-shipping threshold after coupon', () => {
    render(<FreeShippingProgress totals={{ ...totals, subtotal: 800, couponDiscount: 100 }} />);
    expect(screen.getByText(formatINR(299))).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '70');
  });

  it('celebrates once the threshold is reached', () => {
    render(<FreeShippingProgress totals={totals} />);
    expect(screen.getByText(/Your order ships free/)).toBeInTheDocument();
  });
});
