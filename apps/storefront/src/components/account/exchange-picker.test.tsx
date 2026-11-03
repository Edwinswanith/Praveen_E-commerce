import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { orderFixture } from '@/test/fixtures';
import { ExchangePicker } from './exchange-picker';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (orig) => {
  const mod = await orig<typeof import('@/lib/api')>();
  return { ...mod, api: (...args: unknown[]) => apiMock(...args) };
});
const { ReturnDialog } = await import('./order-detail');

// cuid-shaped ids: returnRequestSchema validates them.
const ITEM = 'cmabc0000000000000000item1';
const CAP = 'cmabc0000000000000000item2';
const ORDER = 'cmabc00000000000000order01';
const V_L = 'cmabc0000000000000000varl1';
const V_NAVY_M = 'cmabc0000000000000000varn1';

const delivered = orderFixture({
  id: ORDER,
  status: 'DELIVERED',
  canReturn: true,
  codConfirmation: 'CONFIRMED',
  items: orderFixture().items.map((i, idx) => ({ ...i, id: idx === 0 ? ITEM : CAP })),
  exchangeOptions: {
    [ITEM]: [
      { variantId: V_L, color: 'Black', size: 'L', available: 8 },
      { variantId: V_NAVY_M, color: 'Navy', size: 'M', available: 2 },
    ],
    [CAP]: [],
  },
});

beforeEach(() => apiMock.mockReset());

describe('<ExchangePicker />', () => {
  it('lists colour + size options with low-stock hints and reports the choice', () => {
    const onChange = vi.fn();
    render(
      <ExchangePicker
        itemId="x"
        itemName="Tee"
        current={{ color: 'Black', size: 'M' }}
        options={delivered.exchangeOptions![ITEM]!}
        value={null}
        onChange={onChange}
      />,
    );
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(screen.getByLabelText(/Black · L/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Navy · M/)).toHaveAccessibleName(/2 left/);
    fireEvent.click(screen.getByLabelText(/Navy · M/));
    expect(onChange).toHaveBeenCalledWith(V_NAVY_M);
  });
});

describe('<ReturnDialog /> exchange', () => {
  function open() {
    const onDone = vi.fn();
    render(<ReturnDialog order={delivered} open onOpenChange={vi.fn()} onDone={onDone} />);
    return { onDone };
  }

  it('hides items without options in exchange mode and sends type EXCHANGE + exchangeVariantId', async () => {
    apiMock.mockResolvedValueOnce({ id: 'ret_1' });
    const { onDone } = open();
    fireEvent.click(screen.getByLabelText(/Exchange for another size\/colour/));
    expect(screen.queryByText('Logo Cap')).toBeNull();
    expect(screen.getByText(/can only be returned/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Oversized Tee/));
    // Submitting without a target is blocked client-side.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Request exchange' }));
    });
    expect(apiMock).not.toHaveBeenCalled();
    expect(screen.getByText('Choose a size/colour')).toBeInTheDocument();
    const picker = screen.getByRole('group', { name: /Exchange Oversized Tee/ });
    fireEvent.click(within(picker).getByLabelText(/Black · L/));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Request exchange' }));
    });
    expect(apiMock).toHaveBeenCalledWith('/returns', {
      method: 'POST',
      body: {
        orderId: ORDER,
        type: 'EXCHANGE',
        reason: 'SIZE_ISSUE',
        items: [{ orderItemId: ITEM, quantity: 1, exchangeVariantId: V_L }],
      },
    });
    expect(onDone).toHaveBeenCalled();
  });

  it('keeps refunds the default and offers every item', async () => {
    apiMock.mockResolvedValueOnce({ id: 'ret_2' });
    open();
    expect(screen.getByLabelText(/Return for refund/)).toBeChecked();
    expect(screen.getByText('Logo Cap')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Logo Cap/));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit return' }));
    });
    expect(apiMock).toHaveBeenCalledWith('/returns', {
      method: 'POST',
      body: { orderId: ORDER, type: 'RETURN', reason: 'SIZE_ISSUE', items: [{ orderItemId: CAP, quantity: 1 }] },
    });
  });

  it('does not offer exchange when no item has options', () => {
    render(
      <ReturnDialog
        order={{ ...delivered, exchangeOptions: { [ITEM]: [], [CAP]: [] } }}
        open
        onOpenChange={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/Exchange for another size\/colour/)).toBeNull();
  });
});
