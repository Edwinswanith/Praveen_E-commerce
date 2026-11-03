import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { FunnelStepDto } from '@vyra/shared';
import { FunnelSteps, NoEvents } from './conversion-screen';

const steps: FunnelStepDto[] = [
  { step: 'PRODUCT_VIEW', sessions: 1000, rateFromPrevious: null, rateFromStart: null },
  { step: 'ADD_TO_CART', sessions: 500, rateFromPrevious: 50, rateFromStart: 50 },
  { step: 'CHECKOUT_STARTED', sessions: 190, rateFromPrevious: 38, rateFromStart: 19 },
  { step: 'ORDER_PLACED', sessions: 150, rateFromPrevious: 78.9, rateFromStart: 15 },
];

describe('<FunnelSteps>', () => {
  it('renders the four steps with sessions and % of previous', () => {
    render(<FunnelSteps steps={steps} />);
    for (const label of ['Viewed product', 'Added to bag', 'Started checkout', 'Ordered']) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText('38.0% of previous')).toBeInTheDocument();
    expect(screen.getByText('1,000')).toBeInTheDocument();
  });
  it('highlights only the biggest drop-off', () => {
    const { container } = render(<FunnelSteps steps={steps} />);
    const leaks = container.querySelectorAll('[data-leak]');
    expect(leaks).toHaveLength(1);
    expect(leaks[0]).toHaveTextContent('62.0% drop-off · 310 sessions lost');
    expect(screen.getByText('Biggest leak')).toBeInTheDocument();
  });
});

describe('<NoEvents>', () => {
  it('explains that tracking started with this release', () => {
    render(<NoEvents tryOn={{ total: 0, sessions: 0, sessionsThatOrdered: 0, conversionRate: 0, dailyLimit: 200, usedToday: 0 }} />);
    expect(screen.getByText('No shopper activity recorded yet')).toBeInTheDocument();
    expect(screen.getByText(/tracking started with this release/i)).toBeInTheDocument();
  });
});
