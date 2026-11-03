import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReturnPreviewDto } from '@vyra/shared';
import { formatINR } from '@vyra/shared';
import { orderFixture } from '@/test/fixtures';
import { ReturnPreviewPanel } from './return-preview';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (orig) => {
  const mod = await orig<typeof import('@/lib/api')>();
  return { ...mod, api: (...args: unknown[]) => apiMock(...args) };
});
const { ReturnDialog } = await import('./order-detail');

const TEE = 'cmabc0000000000000000item1';
const CAP = 'cmabc0000000000000000item2';
const order = orderFixture({
  id: 'cmabc00000000000000order01',
  status: 'DELIVERED',
  canReturn: true,
  codConfirmation: 'CONFIRMED',
  items: orderFixture().items.map((i, idx) => ({ ...i, id: idx === 0 ? TEE : CAP })),
});

const preview = (over: Partial<ReturnPreviewDto> = {}): ReturnPreviewDto => ({
  refundAmount: 400,
  itemsValue: 449,
  deductions: [{ label: 'Buy 2, extra 10% off no longer applies to the 1 item you keep (needs 2)', amount: 49 }],
  note: 'Offers are recalculated on the items you keep.',
  ...over,
});

beforeEach(() => {
  apiMock.mockReset();
});

describe('<ReturnPreviewPanel />', () => {
  it('shows the refund, every deduction with its label, and the note', () => {
    render(<ReturnPreviewPanel preview={preview()} loading={false} error={null} onRetry={vi.fn()} />);
    const panel = screen.getByTestId('return-preview');
    expect(within(panel).getByText('You paid for these items').closest('div')).toHaveTextContent(formatINR(449));
    expect(within(panel).getByText(/no longer applies/).closest('div')).toHaveTextContent(`−${formatINR(49)}`);
    expect(screen.getByTestId('refund-amount')).toHaveTextContent(formatINR(400));
    expect(screen.getByText('Offers are recalculated on the items you keep.')).toBeInTheDocument();
  });

  it('shows a negative deduction as money given back, not taken', () => {
    render(
      <ReturnPreviewPanel
        preview={preview({
          refundAmount: 548,
          itemsValue: 499,
          deductions: [{ label: 'Offer deduction from your earlier return, given back', amount: -49 }],
          note: null,
        })}
        loading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );
    const row = screen.getByText(/given back/).closest('div')!;
    expect(row).toHaveTextContent(`+${formatINR(49)}`);
    expect(row.textContent).not.toContain('−');
    expect(screen.getByTestId('refund-amount')).toHaveTextContent(formatINR(548));
  });
});

describe('<ReturnDialog /> refund preview', () => {
  it('previews on every selection change and only then lets the customer submit', async () => {
    apiMock.mockImplementation((path: string, opts: { body: { items: { quantity: number }[] } }) => {
      if (path.endsWith('/return-preview')) {
        const q = opts.body.items[0]!.quantity;
        return Promise.resolve(preview({ refundAmount: q === 1 ? 400 : 998, deductions: q === 1 ? preview().deductions : [], note: q === 1 ? preview().note : null }));
      }
      return Promise.resolve({ id: 'ret_1' });
    });
    render(<ReturnDialog order={order} open onOpenChange={vi.fn()} onDone={vi.fn()} />);
    expect(apiMock).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Oversized Tee/));
    });
    expect(apiMock).toHaveBeenLastCalledWith('/orders/VY-TEST-0001/return-preview', {
      method: 'POST',
      body: { items: [{ orderItemId: TEE, quantity: 1 }] },
    });
    expect(screen.getByTestId('refund-amount')).toHaveTextContent(formatINR(400));
    expect(screen.getByText(/no longer applies/)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Increase/i }));
    });
    expect(apiMock).toHaveBeenLastCalledWith('/orders/VY-TEST-0001/return-preview', {
      method: 'POST',
      body: { items: [{ orderItemId: TEE, quantity: 2 }] },
    });
    expect(screen.getByTestId('refund-amount')).toHaveTextContent(formatINR(998));
    expect(screen.queryByText(/no longer applies/)).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: `Submit return (${formatINR(998)} refund)` }));
    });
    expect(apiMock).toHaveBeenLastCalledWith('/returns', expect.objectContaining({ method: 'POST' }));
  });

  it('holds the submit button until the preview for the current selection has loaded', async () => {
    let resolve: (v: ReturnPreviewDto) => void = () => {};
    apiMock.mockImplementation((path: string) =>
      path.endsWith('/return-preview') ? new Promise<ReturnPreviewDto>((r) => (resolve = r)) : Promise.resolve({ id: 'x' }),
    );
    render(<ReturnDialog order={order} open onOpenChange={vi.fn()} onDone={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Logo Cap/));
    });
    expect(screen.getByRole('button', { name: /^Submit return/ })).toBeDisabled();
    await act(async () => resolve(preview({ refundAmount: 299, itemsValue: 299, deductions: [], note: null })));
    expect(screen.getByRole('button', { name: /^Submit return/ })).toBeEnabled();
  });
});
