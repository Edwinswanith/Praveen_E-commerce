import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ApiError } from '@/lib/api';
import { orderFixture } from '@/test/fixtures';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (orig) => {
  const mod = await orig<typeof import('@/lib/api')>();
  return { ...mod, api: (...args: unknown[]) => apiMock(...args) };
});
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
const { TrackOrder } = await import('./track-order');

/** What GET /orders/track returns for a guest (maskForGuest in the API). */
const masked = orderFixture({
  customerEmail: 'a•••••@example.com',
  codConfirmation: 'CONFIRMED',
  shippingAddress: {
    fullName: 'Aarav Sharma', phone: '••••••••10', line1: '••••••••••••••••••••••••••••••••••••', line2: null, landmark: null,
    city: 'Bengaluru', state: 'Karnataka', pincode: '560001', type: 'HOME',
  },
});

beforeEach(() => apiMock.mockReset());

async function track(contact = '9876543210') {
  render(<TrackOrder />);
  fireEvent.change(screen.getByLabelText('Order number'), { target: { value: 'vy-test-0001' } });
  fireEvent.change(screen.getByLabelText('Email or mobile number'), { target: { value: contact } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /track order/i }));
  });
}

describe('<TrackOrder />', () => {
  it('renders a masked guest order without bullets-only lines or "null"', async () => {
    apiMock.mockResolvedValueOnce(masked);
    await track();
    expect(apiMock).toHaveBeenCalledWith('/orders/track', { query: { number: 'VY-TEST-0001', phone: '9876543210' } });
    const addr = screen.getByTestId('shipping-address');
    expect(addr).toHaveTextContent('Aarav Sharma');
    expect(addr).toHaveTextContent('Bengaluru, Karnataka 560001');
    expect(addr).toHaveTextContent('Phone ending in 10');
    expect(addr.textContent).not.toMatch(/•|null|undefined/);
    expect(screen.getByTestId('address-masked-note')).toHaveTextContent(/hidden here/);
    expect(document.body.textContent).not.toMatch(/\bnull\b|undefined/);
  });

  it('shows the 429 message from the API', async () => {
    apiMock.mockRejectedValueOnce(
      new ApiError('RATE_LIMITED', 'Too many tracking attempts. Please wait an hour or sign in to see your orders.', 429),
    );
    await track('aarav@example.com');
    expect(screen.getByText('Too many tracking attempts. Please wait an hour or sign in to see your orders.')).toBeInTheDocument();
  });

  it('shows the not-found message for a wrong number', async () => {
    apiMock.mockRejectedValueOnce(new ApiError('NOT_FOUND', 'Order not found', 404));
    await track();
    expect(screen.getByText(/couldn’t find an order/i)).toBeInTheDocument();
  });
});
