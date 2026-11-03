import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ORDER_TRANSITIONS, OrderStatus } from '@vyra/shared';
import { ACTION_LABEL, NextStatusActions, nextStatuses } from './next-status';
import { RtoDialog } from './order-dialogs';
import { api } from '@/lib/api';

vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>();
  return { ...actual, api: { ...actual.api, post: vi.fn() } };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Mirrors the order detail page's message (kept local to avoid importing the page module).
const COD_PENDING_PACK_REASON = 'Packing is locked until this Cash on Delivery order is confirmed (customer OTP or a staff call).';

const ALL = Object.values(OrderStatus);

describe('nextStatuses', () => {
  it('matches ORDER_TRANSITIONS for every status', () => {
    for (const s of ALL) expect(nextStatuses(s)).toEqual(ORDER_TRANSITIONS[s]);
  });
});

describe('NextStatusActions', () => {
  it.each(ALL)('offers exactly the valid transitions from %s', (status) => {
    render(<NextStatusActions status={status} onSelect={() => {}} onCancel={() => {}} />);
    const buttons = screen.queryAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('data-status'))).toEqual(ORDER_TRANSITIONS[status]);
    for (const other of ALL.filter((s) => !ORDER_TRANSITIONS[status].includes(s))) {
      expect(screen.queryByRole('button', { name: ACTION_LABEL[other] })).toBeNull();
    }
  });

  it('CONFIRMED offers Mark packed and Cancel, but never Shipped/Delivered', () => {
    render(<NextStatusActions status="CONFIRMED" onSelect={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('button', { name: /mark packed/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel order/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark shipped/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /mark delivered/i })).toBeNull();
  });

  it('calls onSelect with the chosen status, and routes cancel through onCancel', () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    render(<NextStatusActions status="PACKED" onSelect={onSelect} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /mark shipped/i }));
    expect(onSelect).toHaveBeenCalledWith('SHIPPED');
    fireEvent.click(screen.getByRole('button', { name: /cancel order/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('renders nothing actionable for terminal statuses', () => {
    render(<NextStatusActions status="CANCELLED" onSelect={() => {}} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText(/no further status changes/i)).toBeInTheDocument();
  });

  it('hides all actions without orders:write permission', () => {
    const { container } = render(<NextStatusActions status="CONFIRMED" onSelect={() => {}} canWrite={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('NextStatusActions: RTO and COD gating', () => {
  it.each(['SHIPPED', 'OUT_FOR_DELIVERY'] as const)('%s offers RTO, routed through onRto (not onSelect)', (status) => {
    const onSelect = vi.fn();
    const onRto = vi.fn();
    render(<NextStatusActions status={status} onSelect={onSelect} onRto={onRto} />);
    const rto = screen.getByRole('button', { name: /returned to origin \(rto\)/i });
    fireEvent.click(rto);
    expect(onRto).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('never offers RTO before shipping or after delivery', () => {
    for (const s of ['CONFIRMED', 'PACKED', 'DELIVERED', 'RTO'] as const) {
      const { unmount } = render(<NextStatusActions status={s} onSelect={() => {}} onCancel={() => {}} onRto={() => {}} />);
      expect(screen.queryByRole('button', { name: /rto/i })).toBeNull();
      unmount();
    }
  });

  it('RTO is disabled when no onRto handler is wired', () => {
    render(<NextStatusActions status="SHIPPED" onSelect={() => {}} />);
    expect(screen.getByRole('button', { name: /rto/i })).toBeDisabled();
  });

  it('disables Mark packed with an explanation while COD confirmation is pending', () => {
    const onSelect = vi.fn();
    render(<NextStatusActions status="CONFIRMED" onSelect={onSelect} onCancel={() => {}} blocked={{ PACKED: COD_PENDING_PACK_REASON }} />);
    const pack = screen.getByRole('button', { name: /mark packed/i });
    expect(pack).toBeDisabled();
    expect(pack).toHaveAccessibleDescription(COD_PENDING_PACK_REASON);
    expect(screen.getByText(COD_PENDING_PACK_REASON)).toBeInTheDocument();
    fireEvent.click(pack);
    expect(onSelect).not.toHaveBeenCalled();
    // Cancelling stays possible.
    expect(screen.getByRole('button', { name: /cancel order/i })).toBeEnabled();
  });

  it('Mark packed is enabled once COD is confirmed (no block)', () => {
    const onSelect = vi.fn();
    render(<NextStatusActions status="CONFIRMED" onSelect={onSelect} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /mark packed/i }));
    expect(onSelect).toHaveBeenCalledWith('PACKED');
  });
});

describe('RtoDialog', () => {
  // Braces matter: a function returned from beforeEach is run as a teardown hook.
  beforeEach(() => { vi.mocked(api.post).mockReset(); });

  it('requires a note and explains restock + COD refusal before posting status RTO', async () => {
    vi.mocked(api.post).mockResolvedValue({});
    const onDone = vi.fn();
    render(<RtoDialog orderId="o1" number="VY-1" paymentMethod="COD" onClose={() => {}} onDone={onDone} />);
    expect(screen.getByText(/restocked/i)).toBeInTheDocument();
    expect(screen.getByText(/counted against the customer/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /mark rto/i }));
    expect(await screen.findByText(/describe why the parcel came back/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: 'Customer refused at door' } });
    fireEvent.click(screen.getByRole('button', { name: /mark rto/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/orders/o1/status', { status: 'RTO', note: 'Customer refused at door' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('nudges a refund for prepaid orders', () => {
    render(<RtoDialog orderId="o1" number="VY-1" paymentMethod="ONLINE" onClose={() => {}} onDone={() => {}} />);
    expect(screen.getByText(/issue a refund/i)).toBeInTheDocument();
  });
});
