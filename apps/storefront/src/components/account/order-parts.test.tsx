import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { formatINR } from '@vyra/shared';
import { orderFixture } from '@/test/fixtures';
import { orderSavingsLines, OrderTotals } from './order-parts';

describe('order savings breakdown', () => {
  const order = orderFixture({
    mrpTotal: 3198, subtotal: 1338, promotionDiscount: 133, couponCode: 'FESTIVE5', couponDiscount: 60,
    savings: { campaign: 460, promotion: 133, coupon: 60, prepaid: 0 },
  });

  it('splits the savings by source from order.savings', () => {
    expect(orderSavingsLines(order)).toEqual([
      { label: 'Discount on MRP', amount: 1400 },
      { label: 'Sale prices', amount: 460 },
      { label: 'Bundle offer', amount: 133 },
      { label: 'Coupon FESTIVE5', amount: 60 },
    ]);
  });

  it('renders the breakdown with its total', () => {
    render(<OrderTotals order={order} />);
    expect(screen.getByTestId('order-savings')).toHaveTextContent(`You saved ${formatINR(2053)} on this order`);
    expect(within(screen.getByTestId('order-savings')).getByText('Sale prices').closest('div')).toHaveTextContent(formatINR(460));
  });
});
