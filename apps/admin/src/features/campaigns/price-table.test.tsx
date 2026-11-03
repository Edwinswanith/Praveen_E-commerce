import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CampaignPriceRowDto } from '@vyra/shared';
import { PriceTable } from './prices-tab';
import { priceRules, validatePriceEdit } from './campaign-rules';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const row = (over: Partial<CampaignPriceRowDto> = {}): CampaignPriceRowDto => ({
  variantId: 'v1', productId: 'p1', productName: 'Silk Kurta', sku: 'VY-KUR-RED-M', color: 'Red', size: 'M', imageUrl: null,
  mrp: 2000, regularPrice: 1500, costPrice: 600, salePrice: 999, percentOffRegular: 33, percentOffMrp: 50,
  stockCap: 20, soldCount: 5, perCustomerLimit: 2, available: 12, warnings: [], ...over,
});

const draft = priceRules({ status: 'DRAFT', phase: 'DRAFT', startsAt: '2026-11-10T00:00:00Z' });
const live = priceRules({ status: 'SCHEDULED', phase: 'LIVE', startsAt: '2026-11-01T00:00:00Z' }, new Date('2026-11-05T00:00:00Z'));

describe('priceRules', () => {
  it('drafts are fully editable', () => {
    expect(draft).toMatchObject({ readOnly: false, onlyDown: false, canRemove: true });
  });
  it('a live sale only allows price drops and keeps advertised deals', () => {
    expect(live).toMatchObject({ readOnly: false, onlyDown: true, canRemove: false });
  });
  it('a sale paused after starting still keeps its deals', () => {
    expect(priceRules({ status: 'PAUSED', phase: 'PAUSED', startsAt: '2026-11-01T00:00:00Z' }, new Date('2026-11-05T00:00:00Z'))).toMatchObject({ onlyDown: true, canRemove: false });
  });
  it('ended and cancelled campaigns are read-only', () => {
    expect(priceRules({ status: 'SCHEDULED', phase: 'ENDED', startsAt: '2026-11-01T00:00:00Z' }).readOnly).toBe(true);
    expect(priceRules({ status: 'CANCELLED', phase: 'CANCELLED', startsAt: '2026-11-01T00:00:00Z' }).readOnly).toBe(true);
  });
});

describe('validatePriceEdit', () => {
  const ok = { salePrice: '899', stockCap: '20', perCustomerLimit: '2' };
  it('accepts a valid price', () => expect(validatePriceEdit(row(), ok, draft)).toEqual([]));
  it('refuses below cost, not below regular, and raising a running sale price', () => {
    expect(validatePriceEdit(row(), { ...ok, salePrice: '599' }, draft).join()).toMatch(/Below cost/);
    expect(validatePriceEdit(row(), { ...ok, salePrice: '1500' }, draft).join()).toMatch(/below the regular price/);
    expect(validatePriceEdit(row(), { ...ok, salePrice: '1099' }, draft)).toEqual([]);
    expect(validatePriceEdit(row(), { ...ok, salePrice: '1099' }, live).join()).toMatch(/can only go down/);
  });
  it('refuses a cap below units sold and silly limits', () => {
    expect(validatePriceEdit(row(), { ...ok, stockCap: '4' }, live).join()).toMatch(/5 already sold/);
    expect(validatePriceEdit(row(), { ...ok, perCustomerLimit: '99' }, draft).join()).toMatch(/1 to 50/);
    expect(validatePriceEdit(row(), { ...ok, salePrice: '899.999' }, draft).join()).toMatch(/2 decimals/);
  });
});

describe('<PriceTable>', () => {
  it('shows prices, % off regular and MRP, sold/cap, and highlights warnings', () => {
    const rows = [row(), row({ variantId: 'v2', sku: 'VY-KUR-RED-L', size: 'L', salePrice: 500, warnings: ['Below cost price', 'Out of stock'], available: 0 })];
    const { container } = render(<PriceTable rows={rows} rules={draft} canWrite onSave={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getAllByText('33%')).toHaveLength(2);
    expect(screen.getAllByText('50%')).toHaveLength(2);
    expect(screen.getAllByText('5 / 20')).toHaveLength(2);
    expect(container.querySelectorAll('[data-warning]')).toHaveLength(1);
    const warnings = screen.getByRole('list', { name: 'Warnings for VY-KUR-RED-L' });
    expect(within(warnings).getByText('Below cost price')).toBeInTheDocument();
    expect(within(warnings).getByText('Out of stock')).toBeInTheDocument();
  });

  it('edits a row: blocks a below-cost price locally, then saves a valid one', async () => {
    const onSave = vi.fn().mockResolvedValue(null);
    render(<PriceTable rows={[row()]} rules={draft} canWrite onSave={onSave} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit VY-KUR-RED-M' }));
    const price = screen.getByLabelText('Sale price for VY-KUR-RED-M');
    fireEvent.change(price, { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save VY-KUR-RED-M' }));
    expect(await screen.findByText(/Below cost ₹600/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(price, { target: { value: '899' } });
    fireEvent.change(screen.getByLabelText('Stock cap for VY-KUR-RED-M'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save VY-KUR-RED-M' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![1]).toEqual({ salePrice: '899', stockCap: '', perCustomerLimit: '2' });
    await waitFor(() => expect(screen.queryByLabelText('Sale price for VY-KUR-RED-M')).toBeNull());
  });

  it('keeps the row in edit mode and lists every server error', async () => {
    const onSave = vi.fn().mockResolvedValue(['Validation failed', 'Silk Kurta Red/M: ₹650 is below cost ₹700']);
    render(<PriceTable rows={[row()]} rules={draft} canWrite onSave={onSave} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit VY-KUR-RED-M' }));
    fireEvent.change(screen.getByLabelText('Sale price for VY-KUR-RED-M'), { target: { value: '650' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save VY-KUR-RED-M' }));
    expect(await screen.findByText('Silk Kurta Red/M: ₹650 is below cost ₹700')).toBeInTheDocument();
    expect(screen.getByLabelText('Sale price for VY-KUR-RED-M')).toBeInTheDocument();
  });

  it('disables remove on a running sale and hides editing without write access', () => {
    const { unmount } = render(<PriceTable rows={[row()]} rules={live} canWrite onSave={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Remove deal VY-KUR-RED-M' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit VY-KUR-RED-M' })).toBeEnabled();
    unmount();
    render(<PriceTable rows={[row()]} rules={draft} canWrite={false} onSave={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
  });
});
