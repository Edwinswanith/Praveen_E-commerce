import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CodSettingsDto } from '@vyra/shared';
import { BlockedPincodeForm } from './blocked-pincode-form';
import { api, ApiError } from '@/lib/api';

vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>();
  return { ...actual, api: { ...actual.api, post: vi.fn() } };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const settings: CodSettingsDto = {
  enabled: true, rtoBlockThreshold: 2, confirmWindowHours: 24, prepaidDiscountPercent: 5, prepaidDiscountMax: 100,
  blockedPincodes: [{ pincode: '560001', reason: 'High RTO', createdAt: '2026-11-01T00:00:00.000Z' }],
};

const pin = () => screen.getByLabelText('PIN code');
const submit = () => fireEvent.click(screen.getByRole('button', { name: /block pin/i }));

describe('BlockedPincodeForm', () => {
  // Braces matter: a function returned from beforeEach is run as a teardown hook.
  beforeEach(() => { vi.mocked(api.post).mockReset(); });

  it.each(['', '12345', '056001', '56000A', '5600011'])('rejects invalid PIN %j without calling the API', async (value) => {
    render(<BlockedPincodeForm onSaved={() => {}} />);
    fireEvent.change(pin(), { target: { value } });
    submit();
    expect(await screen.findByText(/valid 6-digit pin code/i)).toBeInTheDocument();
    expect(pin()).toHaveAttribute('aria-invalid', 'true');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('rejects an over-long reason', async () => {
    render(<BlockedPincodeForm onSaved={() => {}} />);
    fireEvent.change(pin(), { target: { value: '560001' } });
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'x'.repeat(201) } });
    submit();
    await waitFor(() => expect(screen.getByLabelText(/reason/i)).toHaveAttribute('aria-invalid', 'true'));
    expect(api.post).not.toHaveBeenCalled();
  });

  it('posts a valid PIN (trimmed, optional reason omitted) and returns the new settings', async () => {
    vi.mocked(api.post).mockResolvedValue(settings);
    const onSaved = vi.fn();
    render(<BlockedPincodeForm onSaved={onSaved} />);
    fireEvent.change(pin(), { target: { value: ' 560001 ' } });
    submit();
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/cod/blocked-pincodes', { pincode: '560001' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(settings));
    expect(pin()).toHaveValue('');
  });

  it('sends the reason when given', async () => {
    vi.mocked(api.post).mockResolvedValue(settings);
    render(<BlockedPincodeForm onSaved={() => {}} />);
    fireEvent.change(pin(), { target: { value: '110001' } });
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: '  Frequent refusals ' } });
    submit();
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/cod/blocked-pincodes', { pincode: '110001', reason: 'Frequent refusals' }));
  });

  it('maps API field errors onto the form', async () => {
    vi.mocked(api.post).mockImplementation(async () => { throw new ApiError('VALIDATION_FAILED', 'Invalid', 422, { fieldErrors: { pincode: ['PIN code is not serviceable'] } }); });
    render(<BlockedPincodeForm onSaved={() => {}} />);
    fireEvent.change(pin(), { target: { value: '999999' } });
    submit();
    expect(await screen.findByText('PIN code is not serviceable')).toBeInTheDocument();
  });
});
