import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ORDER_TRANSITIONS, OrderStatus } from '@vyra/shared';
import { ACTION_LABEL, NextStatusActions, nextStatuses } from './next-status';

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
