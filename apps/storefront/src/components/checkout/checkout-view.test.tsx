import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { AddressDto, CartDto, CartTotalsDto, SessionUser } from '@vyra/shared';
import { formatINR } from '@vyra/shared';
import { ApiError } from '@/lib/api';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (orig) => {
  const mod = await orig<typeof import('@/lib/api')>();
  return { ...mod, api: (...args: unknown[]) => apiMock(...args) };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/analytics', async (orig) => ({ ...(await orig<typeof import('@/lib/analytics')>()), track: vi.fn() }));
const user: SessionUser = {
  id: 'u1', name: 'Aarav', email: 'aarav@example.com', phone: '9876543210', emailVerified: true,
  phoneVerified: true, marketingOptIn: false, role: 'CUSTOMER' as SessionUser['role'], permissions: [],
};
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user, loading: false }) }));
const refreshCart = vi.fn().mockResolvedValue(undefined);
let cart: CartDto;
vi.mock('@/hooks/use-cart', () => ({
  useCart: () => ({ cart, error: null, isLoading: false, refresh: refreshCart }),
}));
const { CheckoutView } = await import('./checkout-view');

const totals = (grandTotal: number): CartTotalsDto => ({
  mrpTotal: 3198, subtotal: 1338, productDiscount: 1860, couponDiscount: 0, promotionDiscount: 133,
  promotionName: 'Buy 2, extra 10% off', campaignSavings: 460, offerNote: null, prepaidDiscount: 0,
  prepaidSavings: 0, shippingFee: 0, codFee: 0, taxTotal: 57, grandTotal, codAvailable: true,
  codUnavailableReason: null, freeShippingThreshold: 999,
});
const address: AddressDto = {
  id: 'a1', fullName: 'Aarav Sharma', phone: '9876543210', line1: '12 MG Road', line2: null, landmark: null,
  city: 'Bengaluru', state: 'Karnataka', pincode: '560001', type: 'HOME', isDefault: true,
};

let quoteTotal = 1205;
beforeEach(() => {
  quoteTotal = 1205;
  apiMock.mockReset();
  cart = {
    id: 'cart1',
    items: [
      {
        id: 'ci1', variantId: 'v1', productId: 'p1', productSlug: 'kurta', name: 'Everyday Cotton Kurta', brand: 'VYRA',
        imageUrl: null, color: 'White', size: 'M', sku: 'K-W-M', quantity: 2, unitPrice: 669, unitMrp: 1599,
        lineTotal: 1338, available: 5, purchasable: true, savedForLater: false,
      },
    ],
    savedItems: [], couponCode: null, couponError: null, couponAutoApplied: false, totals: totals(1205), itemCount: 2,
  };
  apiMock.mockImplementation((path: string) => {
    if (path === '/users/me/addresses') return Promise.resolve([address]);
    if (path === '/shipping/serviceability')
      return Promise.resolve({ pincode: '560001', serviceable: true, codAvailable: true, estimatedDays: { min: 2, max: 4 }, expressAvailable: true, city: null, state: null });
    if (path === '/checkout/quote') return Promise.resolve({ ...totals(quoteTotal), couponError: null });
    if (path === '/checkout') {
      // The sale ended while the shopper was on the page.
      quoteTotal = 1488;
      return Promise.reject(new ApiError('PRICE_CHANGED', 'Prices changed', 409, { grandTotal: 1488 }));
    }
    return Promise.reject(new Error(`unexpected ${path}`));
  });
});

function renderCheckout() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), fetcher: (p: string) => apiMock(p), dedupingInterval: 0 }}>
      <CheckoutView />
    </SWRConfig>,
  );
}

const checkoutCalls = () => apiMock.mock.calls.filter(([p]) => p === '/checkout');

describe('<CheckoutView /> price changed', () => {
  it('sends the displayed total, and on PRICE_CHANGED refreshes the quote and asks the shopper to confirm again', async () => {
    renderCheckout();
    await act(async () => {});
    const pay = screen.getByRole('button', { name: `Pay ${formatINR(1205)}` });
    await act(async () => {
      fireEvent.click(pay);
    });
    expect(checkoutCalls()).toHaveLength(1);
    expect(checkoutCalls()[0]![1]).toMatchObject({ method: 'POST', body: { expectedTotal: 1205, paymentMethod: 'ONLINE' } });
    await act(async () => {});

    const alert = screen.getByTestId('price-changed');
    expect(alert).toHaveTextContent(`Your new total is ${formatINR(1488)} (was ${formatINR(1205)})`);
    // The quote was refetched and the button now shows the new total...
    expect(screen.getByRole('button', { name: `Pay ${formatINR(1488)}` })).toBeEnabled();
    expect(screen.getByTestId('grand-total')).toHaveTextContent(formatINR(1488));
    expect(refreshCart).toHaveBeenCalled();
    // ...but nothing was resubmitted on the shopper's behalf.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(checkoutCalls()).toHaveLength(1);
  });

  it('shows bundle and sale savings lines in the order summary', async () => {
    renderCheckout();
    await act(async () => {});
    expect(screen.getByText('Bundle: Buy 2, extra 10% off')).toBeInTheDocument();
    expect(screen.getByTestId('sale-savings')).toHaveTextContent(formatINR(460));
  });
});
