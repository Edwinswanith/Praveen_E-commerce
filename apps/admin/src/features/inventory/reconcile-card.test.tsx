import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { api, ApiError } from '@/lib/api';
import { ReconcileCard } from './reconcile-card';

vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>();
  return { ...actual, api: { ...actual.api, get: vi.fn() } };
});

const at = '2026-11-03T10:00:00.000Z';

describe('<ReconcileCard>', () => {
  beforeEach(() => { vi.mocked(api.get).mockReset(); });

  it('does not run until asked', () => {
    render(<ReconcileCard />);
    expect(api.get).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /run check/i })).toBeInTheDocument();
  });

  it('shows the consistent state', async () => {
    vi.mocked(api.get).mockResolvedValue({ checkedVariants: 1234, consistent: true, drift: [], checkedAt: at });
    render(<ReconcileCard />);
    fireEvent.click(screen.getByRole('button', { name: /run check/i }));
    expect(await screen.findByText(/1,234 variants checked at/)).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/inventory/reconcile');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: /run again/i })).toBeInTheDocument();
  });

  it('lists drifted SKUs with on-hand vs ledger values in a red alert', async () => {
    vi.mocked(api.get).mockResolvedValue({
      checkedVariants: 50, consistent: false, checkedAt: at,
      drift: [{ variantId: 'v1', sku: 'VY-TS-BLK-M', onHand: 12, ledgerOnHand: 10, reserved: 1, ledgerReserved: 0 }],
    });
    render(<ReconcileCard />);
    fireEvent.click(screen.getByRole('button', { name: /run check/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/1 of 50 variants/);
    expect(alert).toHaveTextContent(/bypassed the ledger and must be investigated/);
    const row = screen.getByText('VY-TS-BLK-M').closest('tr')!;
    expect(Array.from(row.querySelectorAll('td')).map((td) => td.textContent)).toEqual(['VY-TS-BLK-M', '12', '10', '1', '0']);
  });

  it('shows an error when the check fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError('INTERNAL', 'Boom', 500));
    render(<ReconcileCard />);
    fireEvent.click(screen.getByRole('button', { name: /run check/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom');
  });
});
