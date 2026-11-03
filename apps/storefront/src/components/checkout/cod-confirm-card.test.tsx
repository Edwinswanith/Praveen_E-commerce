import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ApiError } from '@/lib/api';
import { recallCodOtp } from '@/lib/checkout-session';
import { orderFixture } from '@/test/fixtures';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (orig) => {
  const mod = await orig<typeof import('@/lib/api')>();
  return { ...mod, api: (...args: unknown[]) => apiMock(...args) };
});
const { CodConfirmCard } = await import('./cod-confirm-card');

const order = orderFixture();
const hint = {
  phoneMasked: '+91 98******10',
  expiresInSeconds: 300,
  devCode: '111222',
  sentAt: Date.now(),
  resendAfterSeconds: 30,
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  apiMock.mockReset();
  sessionStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('<CodConfirmCard />', () => {
  it('explains the 24h rule, shows the dev hint and confirms with the entered code', async () => {
    const confirmed = orderFixture({ codConfirmation: 'CONFIRMED' });
    apiMock.mockResolvedValueOnce(confirmed);
    const onConfirmed = vi.fn();
    render(<CodConfirmCard order={order} hint={{ ...hint, sentAt: Date.now() }} onConfirmed={onConfirmed} />);
    expect(screen.getByRole('heading', { name: /confirm your cash on delivery order/i })).toBeInTheDocument();
    expect(screen.getByText(/cancelled automatically after 24 hours/i)).toBeInTheDocument();
    expect(screen.getByTestId('dev-code-hint')).toHaveTextContent('111222');
    const input = screen.getByLabelText('Confirmation code');
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    fireEvent.change(input, { target: { value: '111222' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirm order/i }));
    });
    expect(apiMock).toHaveBeenCalledWith('/orders/VY-TEST-0001/confirm-cod', {
      method: 'POST',
      body: { code: '111222' },
    });
    expect(onConfirmed).toHaveBeenCalledWith(confirmed);
  });

  it('shows the server error for a wrong code and does not call onConfirmed', async () => {
    apiMock.mockRejectedValueOnce(new ApiError('BAD_REQUEST', 'Incorrect code. 4 attempts left.', 400));
    const onConfirmed = vi.fn();
    render(<CodConfirmCard order={order} hint={null} onConfirmed={onConfirmed} />);
    // Without a stored hint we still know which phone it went to.
    expect(screen.getByText('+91 98******10')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Confirmation code'), { target: { value: '000000' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirm order/i }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Incorrect code. 4 attempts left.');
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it('validates the code locally before calling the API', async () => {
    render(<CodConfirmCard order={order} hint={null} onConfirmed={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Confirmation code'), { target: { value: '12' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirm order/i }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the 6-digit code');
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('resends after the countdown and persists the new hint for refreshes', async () => {
    apiMock.mockResolvedValueOnce({
      phoneMasked: '+91 98******10',
      expiresInSeconds: 300,
      resendAfterSeconds: 30,
      devCode: '333444',
    });
    render(<CodConfirmCard order={order} hint={{ ...hint, sentAt: Date.now() }} onConfirmed={vi.fn()} />);
    expect(screen.getByRole('button', { name: /resend in 30s/i })).toBeDisabled();
    act(() => vi.advanceTimersByTime(30_000));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
    });
    expect(apiMock).toHaveBeenCalledWith('/orders/VY-TEST-0001/resend-cod-otp', { method: 'POST' });
    expect(screen.getByTestId('dev-code-hint')).toHaveTextContent('333444');
    expect(screen.getByRole('button', { name: /resend in 30s/i })).toBeDisabled();
    expect(recallCodOtp('VY-TEST-0001')?.devCode).toBe('333444');
  });

  it('starts the countdown from retryAfterSeconds on a 429', async () => {
    apiMock.mockRejectedValueOnce(new ApiError('RATE_LIMITED', 'wait', 429, { retryAfterSeconds: 20 }));
    render(<CodConfirmCard order={order} hint={null} onConfirmed={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
    });
    expect(screen.getByRole('button', { name: /resend in 20s/i })).toBeDisabled();
    expect(screen.getByText(/wait 20s before requesting/i)).toBeInTheDocument();
  });
});
