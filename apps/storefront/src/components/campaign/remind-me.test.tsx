import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { CampaignPublicDto, RemindMeResponse, SessionUser } from '@vyra/shared';
import { ApiError } from '@/lib/api';

const apiMock = vi.fn();
let user: Partial<SessionUser> | null = null;
vi.mock('@/lib/api', async (orig) => {
  const mod = await orig<typeof import('@/lib/api')>();
  return { ...mod, api: (...args: unknown[]) => apiMock(...args) };
});
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user, loading: false }) }));
const { RemindMe, channelsMessage } = await import('./remind-me');

function campaign(over: Partial<CampaignPublicDto> = {}): CampaignPublicDto {
  return {
    id: 'cmp_1', slug: 'festive-edit', name: 'Festive Edit Sale', edition: '2026', festival: 'Diwali', description: null,
    phase: 'TEASER', teaserStartsAt: '2026-11-01T00:00:00.000Z', earlyAccessStartsAt: null,
    startsAt: '2026-11-10T04:30:00.000Z', endsAt: '2026-11-20T04:30:00.000Z', extended: false, originalEndsAt: null,
    countdownTo: '2026-11-10T04:30:00.000Z', banner: { title: null, subtitle: null, imageUrl: null, themeColor: null },
    claim: { upToPercent: null, productCount: 0 }, promotions: [], hasEarlyAccess: false, subscribed: false,
    ...over,
  };
}

const otpStep: RemindMeResponse = {
  subscribed: false, earlyAccess: false, channels: [],
  otp: { phoneMasked: '+91 91••••••01', expiresInSeconds: 300, resendAfterSeconds: 30, devCode: '123456' },
};
const PATH = '/campaigns/festive-edit/remind-me';

beforeEach(() => {
  apiMock.mockReset();
  user = null;
});

async function click(name: RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
}

describe('<RemindMe /> guest', () => {
  async function toCodeStep() {
    apiMock.mockResolvedValueOnce(otpStep);
    render(<RemindMe campaign={campaign()} />);
    expect(screen.getByText(/only for this sale and you can stop them anytime/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '9123499901' } });
    await click(/send code/i);
    expect(apiMock).toHaveBeenCalledWith(PATH, { method: 'POST', body: { phone: '9123499901' } });
  }

  it('asks for the code after step 1 and sends it with the phone', async () => {
    await toCodeStep();
    expect(screen.getByText('+91 91••••••01')).toBeInTheDocument();
    const input = screen.getByLabelText('6-digit code');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(screen.getByTestId('dev-code-hint')).toHaveTextContent('123456');
    expect(input).toHaveValue('');
    expect(screen.getByRole('button', { name: /resend in/i })).toBeDisabled();

    apiMock.mockResolvedValueOnce({ subscribed: true, earlyAccess: false, otp: null, channels: ['whatsapp'] });
    fireEvent.change(input, { target: { value: '123456' } });
    await click(/^confirm$/i);
    expect(apiMock).toHaveBeenLastCalledWith(PATH, { method: 'POST', body: { phone: '9123499901', code: '123456' } });
    expect(screen.getByTestId('remind-me-done')).toHaveTextContent('You’re on the list for Festive Edit Sale');
    expect(screen.getByTestId('remind-me-channels')).toHaveTextContent('We’ll remind you on WhatsApp.');
    // Guests can't withdraw from the site (DELETE is signed-in only).
    expect(screen.queryByRole('button', { name: /stop reminders/i })).toBeNull();
  });

  it('shows the server message for a wrong code and stays on the code step', async () => {
    await toCodeStep();
    apiMock.mockRejectedValueOnce(new ApiError('BAD_REQUEST', 'Incorrect code. 4 attempts left.', 400));
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '000000' } });
    await click(/^confirm$/i);
    expect(screen.getByText('Incorrect code. 4 attempts left.')).toBeInTheDocument();
    expect(screen.queryByTestId('remind-me-done')).toBeNull();
    expect(screen.getByLabelText('6-digit code')).toBeInTheDocument();
  });

  it('does not call the API with an invalid number or a short code', async () => {
    render(<RemindMe campaign={campaign()} />);
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '12345' } });
    await click(/send code/i);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('shows the rate-limit message', async () => {
    apiMock.mockRejectedValueOnce(new ApiError('RATE_LIMITED', 'Too many requests. Please slow down.', 429));
    render(<RemindMe campaign={campaign()} />);
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '9123499901' } });
    await click(/send code/i);
    expect(screen.getByText('Too many requests. Please slow down.')).toBeInTheDocument();
  });
});

describe('<RemindMe /> signed in', () => {
  beforeEach(() => {
    user = { id: 'u_1', name: 'Aarav', email: 'aarav@example.com' };
  });

  it('subscribes in one tap with an empty body and says which channels will be used', async () => {
    apiMock.mockResolvedValueOnce({ subscribed: true, earlyAccess: false, otp: null, channels: ['whatsapp', 'email'] });
    const onChange = vi.fn();
    render(<RemindMe campaign={campaign()} onChange={onChange} />);
    expect(screen.queryByLabelText('Mobile number')).toBeNull();
    await click(/remind me/i);
    expect(apiMock).toHaveBeenCalledWith(PATH, { method: 'POST', body: {} });
    expect(screen.getByTestId('remind-me-channels')).toHaveTextContent('We’ll remind you on WhatsApp and email.');
    expect(onChange).toHaveBeenCalledWith({ subscribed: true });
  });

  it('“Stop reminders” calls DELETE and shows the form again', async () => {
    apiMock.mockResolvedValueOnce({ subscribed: false, removed: 1 });
    const onChange = vi.fn();
    render(<RemindMe campaign={campaign({ subscribed: true })} onChange={onChange} />);
    expect(screen.getByTestId('remind-me-done')).toBeInTheDocument();
    await click(/stop reminders/i);
    expect(apiMock).toHaveBeenCalledWith(PATH, { method: 'DELETE' });
    expect(screen.getByTestId('remind-me-stopped')).toHaveTextContent('Reminders stopped');
    expect(screen.getByRole('button', { name: /remind me/i })).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith({ subscribed: false });
  });

  it('is honest when only email (or nothing) can be used', () => {
    expect(channelsMessage(['email'])).toMatch(/^We’ll remind you by email\./);
    expect(channelsMessage(['email'])).not.toMatch(/WhatsApp\./);
    expect(channelsMessage([])).toMatch(/can’t send reminders/);
  });
});
