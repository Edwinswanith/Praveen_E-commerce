import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ApiError } from '@/lib/api';
import { useCountdown } from '@/hooks/use-countdown';
import { DevCodeHint, OtpCodeInput, ResendCode } from './otp-input';

const apiMock = vi.fn();
const verifyOtp = vi.fn();
vi.mock('@/lib/api', async (orig) => {
  const mod = await orig<typeof import('@/lib/api')>();
  return { ...mod, api: (...args: unknown[]) => apiMock(...args) };
});
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ verifyOtp }) }));

// Imported after the mocks are declared (vi.mock is hoisted anyway).
const { PhoneLogin } = await import('../auth/phone-login');

function CountdownHarness({ seconds }: { seconds: number }) {
  const { remaining, start } = useCountdown();
  const [resends, setResends] = React.useState(0);
  React.useEffect(() => start(seconds), [seconds, start]);
  return (
    <>
      <ResendCode
        remaining={remaining}
        onResend={() => {
          setResends((n) => n + 1);
          start(seconds);
        }}
      />
      <span data-testid="resends">{resends}</span>
    </>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  apiMock.mockReset();
  verifyOtp.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('<OtpCodeInput />', () => {
  it('is a single numeric one-time-code field that keeps only 6 digits', () => {
    function H() {
      const [v, setV] = React.useState('');
      return <OtpCodeInput aria-label="code" value={v} onChange={setV} />;
    }
    render(<H />);
    const input = screen.getByLabelText('code');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    fireEvent.change(input, { target: { value: '12a 34-5678' } });
    expect(input).toHaveValue('123456');
  });
});

describe('<ResendCode /> countdown', () => {
  it('stays disabled until the resend window elapses, then restarts on resend', () => {
    render(<CountdownHarness seconds={30} />);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent('Resend in 30s');
    act(() => vi.advanceTimersByTime(12_000));
    expect(btn).toHaveTextContent('Resend in 18s');
    act(() => vi.advanceTimersByTime(18_000));
    expect(btn).toBeEnabled();
    expect(btn).toHaveTextContent('Resend code');
    fireEvent.click(btn);
    expect(screen.getByTestId('resends')).toHaveTextContent('1');
    expect(btn).toBeDisabled();
  });
});

describe('<DevCodeHint />', () => {
  it('renders only when a dev code is present', () => {
    const { rerender } = render(<DevCodeHint code={undefined} />);
    expect(screen.queryByTestId('dev-code-hint')).toBeNull();
    rerender(<DevCodeHint code="123456" />);
    expect(screen.getByTestId('dev-code-hint')).toHaveTextContent('DEV MODE: code is 123456');
  });
});

describe('<PhoneLogin />', () => {
  async function sendCode() {
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '+91 98765 43210' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /get otp/i }));
    });
  }

  it('requests a code, shows the dev hint without auto-filling, and counts down to resend', async () => {
    apiMock.mockResolvedValueOnce({
      phoneMasked: '+91 98******10',
      expiresInSeconds: 300,
      resendAfterSeconds: 30,
      devCode: '424242',
    });
    render(<PhoneLogin onSuccess={vi.fn()} />);
    await sendCode();
    expect(apiMock).toHaveBeenCalledWith('/auth/otp/request', {
      method: 'POST',
      body: { phone: '9876543210' },
    });
    expect(screen.getByText('+91 98******10')).toBeInTheDocument();
    expect(screen.getByTestId('dev-code-hint')).toHaveTextContent('424242');
    expect(screen.getByLabelText('6-digit code')).toHaveValue('');
    const resend = screen.getByRole('button', { name: /resend in 30s/i });
    expect(resend).toBeDisabled();
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByRole('button', { name: 'Resend code' })).toBeEnabled();
  });

  it('honours retryAfterSeconds from a 429', async () => {
    apiMock.mockRejectedValueOnce(
      new ApiError('RATE_LIMITED', 'Please wait 12s', 429, { retryAfterSeconds: 12 }),
    );
    render(<PhoneLogin onSuccess={vi.fn()} />);
    await sendCode();
    expect(screen.getByRole('button', { name: /resend in 12s/i })).toBeDisabled();
    expect(screen.getByText(/request a new one in 12s/i)).toBeInTheDocument();
  });

  it('asks for a name on needsName and resubmits the same code with the opt-in', async () => {
    apiMock.mockResolvedValueOnce({ phoneMasked: '+91 98******10', expiresInSeconds: 300, resendAfterSeconds: 30 });
    const onSuccess = vi.fn();
    verifyOtp
      .mockRejectedValueOnce(
        new ApiError('VALIDATION_FAILED', 'Tell us your name', 422, {
          fieldErrors: { name: ['Required for new accounts'] },
          needsName: true,
        }),
      )
      .mockResolvedValueOnce({ user: { name: 'Riya' }, isNewUser: true });
    render(<PhoneLogin onSuccess={onSuccess} />);
    await sendCode();
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '654321' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /verify/i }));
    });
    expect(verifyOtp).toHaveBeenLastCalledWith({ phone: '9876543210', code: '654321' });
    const optIn = screen.getByLabelText('Send me offers and bag reminders on WhatsApp');
    expect(optIn).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Riya Kapoor' } });
    fireEvent.click(optIn);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    });
    expect(verifyOtp).toHaveBeenLastCalledWith({
      phone: '9876543210',
      code: '654321',
      name: 'Riya Kapoor',
      marketingOptIn: true,
    });
    expect(onSuccess).toHaveBeenCalledWith({ user: { name: 'Riya' }, isNewUser: true });
  });
});
