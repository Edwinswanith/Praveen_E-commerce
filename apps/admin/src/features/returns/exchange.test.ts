import { describe, expect, it } from 'vitest';
import { exchangeLabel } from './exchange';
import { actionLabel, returnActions } from './returns-screen';

const item = (from: { size: string; color: string }, to: { size: string; color: string } | null) => ({ orderItemId: 'i', name: 'Tee', sku: 'VY-TSH-00001-BLK-M', quantity: 1, ...from, exchangeFor: to && { variantId: 'v', sku: 'X', ...to } });

describe('exchange helpers', () => {
  it('describes a size exchange as "M → L, Black"', () => {
    expect(exchangeLabel(item({ size: 'M', color: 'Black' }, { size: 'L', color: 'Black' }))).toBe('M → L, Black');
  });
  it('describes colour-only and combined exchanges from the real original values', () => {
    expect(exchangeLabel(item({ size: 'M', color: 'Black' }, { size: 'M', color: 'Navy' }))).toBe('Black → Navy, M');
    expect(exchangeLabel(item({ size: 'M', color: 'Black' }, { size: 'L', color: 'Navy' }))).toBe('Black M → Navy L');
    expect(exchangeLabel(item({ size: 'M', color: 'Black' }, null))).toBe('');
  });
  it('labels RECEIVE for exchanges and hides REFUND once a replacement exists', () => {
    expect(actionLabel({ type: 'EXCHANGE' }, 'RECEIVE')).toBe('Receive & create replacement');
    expect(actionLabel({ type: 'RETURN' }, 'RECEIVE')).toBe('Mark received');
    expect(returnActions({ status: 'RECEIVED', type: 'EXCHANGE', replacementOrderNumber: 'VY-2' })).toEqual([]);
    expect(returnActions({ status: 'RECEIVED', type: 'RETURN', replacementOrderNumber: null })).toEqual(['REFUND']);
    expect(returnActions({ status: 'EXCHANGED', type: 'EXCHANGE', replacementOrderNumber: 'VY-2' })).toEqual([]);
  });
});
