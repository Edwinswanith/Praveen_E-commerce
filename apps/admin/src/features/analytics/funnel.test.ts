import { describe, expect, it } from 'vitest';
import type { FunnelStepDto } from '@vyra/shared';
import { biggestLeak, dropOffs, isLowInterest, leakMessage, quotaUsage, sourceLabel, tryOnUplift } from './funnel';

const steps = (v: number, c: number, k: number, o: number): FunnelStepDto[] => [
  { step: 'PRODUCT_VIEW', sessions: v, rateFromPrevious: null, rateFromStart: null },
  { step: 'ADD_TO_CART', sessions: c, rateFromPrevious: null, rateFromStart: null },
  { step: 'CHECKOUT_STARTED', sessions: k, rateFromPrevious: null, rateFromStart: null },
  { step: 'ORDER_PLACED', sessions: o, rateFromPrevious: null, rateFromStart: null },
];

describe('biggest leak', () => {
  it('finds the transition with the largest relative drop-off and phrases it', () => {
    const leak = biggestLeak(steps(1000, 500, 190, 150));
    expect(leak).toMatchObject({ from: 'ADD_TO_CART', to: 'CHECKOUT_STARTED', lost: 310, dropPct: 62 });
    expect(leakMessage(leak!)).toBe('Biggest leak: 62% of shoppers who add to bag never start checkout');
  });
  it('uses share, not absolute sessions lost', () => {
    // 1000→400 loses 600 (60%); 400→40 loses 360 (90%).
    expect(biggestLeak(steps(1000, 400, 40, 40))?.to).toBe('CHECKOUT_STARTED');
    expect(leakMessage(biggestLeak(steps(100, 100, 100, 10))!)).toBe('Biggest leak: 90% of shoppers who start checkout never place an order');
  });
  it('prefers the earliest step on ties and clamps negative drops', () => {
    expect(biggestLeak(steps(100, 50, 25, 30))?.to).toBe('ADD_TO_CART');
    expect(dropOffs(steps(10, 5, 2, 4))[2]).toMatchObject({ lost: 0, dropPct: 0 });
  });
  it('returns null when nothing is lost or there is no traffic', () => {
    expect(biggestLeak(steps(0, 0, 0, 0))).toBeNull();
    expect(biggestLeak(steps(5, 5, 5, 5))).toBeNull();
  });
});

describe('source labels', () => {
  it('maps tag and direct to staff-friendly names', () => {
    expect(sourceLabel('tag')).toBe('Garment tag QR');
    expect(sourceLabel('direct')).toBe('Direct / unknown');
    expect(sourceLabel('')).toBe('Direct / unknown');
  });
  it('capitalises other utm sources', () => {
    expect(sourceLabel('instagram')).toBe('Instagram');
    expect(sourceLabel('google_ads')).toBe('Google ads');
  });
});

describe('low-interest flag', () => {
  it('flags products with ≥20 views and view→bag under 5%', () => {
    expect(isLowInterest({ views: 20, viewToCartRate: 4.9 })).toBe(true);
    expect(isLowInterest({ views: 120, viewToCartRate: 0 })).toBe(true);
  });
  it('does not flag low-traffic or healthy products', () => {
    expect(isLowInterest({ views: 19, viewToCartRate: 0 })).toBe(false);
    expect(isLowInterest({ views: 50, viewToCartRate: 5 })).toBe(false);
  });
});

describe('try-on and quota helpers', () => {
  it('computes uplift vs overall conversion', () => {
    const t = { total: 10, sessions: 8, sessionsThatOrdered: 2, conversionRate: 25, dailyLimit: 200, usedToday: 3 };
    expect(tryOnUplift(t, 5)).toEqual({ points: 20, ratio: 5 });
    expect(tryOnUplift({ ...t, sessions: 0 }, 5)).toBeNull();
    expect(tryOnUplift(t, 0)?.ratio).toBeNull();
  });
  it('warns at 80% of the daily try-on limit', () => {
    expect(quotaUsage(160, 200)).toEqual({ pct: 80, warn: true });
    expect(quotaUsage(159, 200).warn).toBe(false);
    expect(quotaUsage(0, 0)).toEqual({ pct: 0, warn: false });
  });
});
