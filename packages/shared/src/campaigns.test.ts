import { describe, expect, it } from 'vitest';
import { computeCampaignPhase, nextBoundary, priceCart, resolveSalePrice, validateCampaignWindow, type CampaignPriceOffer } from './index';

const IST = (s: string) => new Date(`${s}+05:30`);
const camp = { status: 'SCHEDULED' as const, teaserStartsAt: IST('2026-10-01T00:00:00'), earlyAccessStartsAt: IST('2026-10-08T00:00:00'), startsAt: IST('2026-10-09T00:00:00'), endsAt: IST('2026-10-19T00:00:00') };

describe('campaign phases (half-open windows, IST)', () => {
  it('moves through every phase exactly at the boundary', () => {
    expect(computeCampaignPhase(camp, IST('2026-09-30T23:59:59'))).toBe('UPCOMING');
    expect(computeCampaignPhase(camp, IST('2026-10-01T00:00:00'))).toBe('TEASER');
    expect(computeCampaignPhase(camp, IST('2026-10-08T00:00:00'))).toBe('EARLY_ACCESS');
    expect(computeCampaignPhase(camp, IST('2026-10-09T00:00:00'))).toBe('LIVE');
    expect(computeCampaignPhase(camp, IST('2026-10-18T23:59:59'))).toBe('LIVE');
    expect(computeCampaignPhase(camp, IST('2026-10-19T00:00:00'))).toBe('ENDED');
  });
  it('honours admin status', () => {
    expect(computeCampaignPhase({ ...camp, status: 'DRAFT' }, IST('2026-10-10T00:00:00'))).toBe('DRAFT');
    expect(computeCampaignPhase({ ...camp, status: 'PAUSED' }, IST('2026-10-10T00:00:00'))).toBe('PAUSED');
    expect(computeCampaignPhase({ ...camp, status: 'PAUSED' }, IST('2026-10-20T00:00:00'))).toBe('ENDED');
  });
  it('gives the next boundary for countdowns', () => {
    expect(nextBoundary(camp, IST('2026-10-08T10:00:00'))!.toISOString()).toBe(IST('2026-10-09T00:00:00').toISOString());
    expect(nextBoundary(camp, IST('2026-10-20T00:00:00'))).toBeNull();
  });
  it('validates windows', () => {
    expect(validateCampaignWindow(camp)).toEqual([]);
    expect(validateCampaignWindow({ ...camp, endsAt: camp.startsAt })[0]!.field).toBe('endsAt');
    expect(validateCampaignWindow({ ...camp, earlyAccessStartsAt: IST('2026-10-01T00:00:00') }).map((p) => p.field)).toContain('earlyAccessStartsAt');
  });
});

describe('sale price resolution', () => {
  const offer = (o: Partial<CampaignPriceOffer>): CampaignPriceOffer => ({ campaignId: 'c1', campaignName: 'Diwali', campaignSlug: 'diwali', priority: 0, salePrice: 59900, phase: 'LIVE', endsAt: camp.endsAt, soldOut: false, ...o });
  const base = { price: 79900, mrp: 129900 };
  it('applies a live sale price and the best of overlapping campaigns', () => {
    expect(resolveSalePrice(base, [offer({})], { hasEarlyAccess: false })).toMatchObject({ price: 59900, basePrice: 79900, campaign: { slug: 'diwali' } });
    const r = resolveSalePrice(base, [offer({}), offer({ campaignId: 'c2', campaignSlug: 'ethnic', salePrice: 54900 })], { hasEarlyAccess: false });
    expect(r.price).toBe(54900);
    expect(r.campaign!.slug).toBe('ethnic');
  });
  it('early access only for eligible shoppers; never when sold out, ended or above regular price', () => {
    expect(resolveSalePrice(base, [offer({ phase: 'EARLY_ACCESS' })], { hasEarlyAccess: false }).price).toBe(79900);
    expect(resolveSalePrice(base, [offer({ phase: 'EARLY_ACCESS' })], { hasEarlyAccess: true }).price).toBe(59900);
    expect(resolveSalePrice(base, [offer({ soldOut: true })], { hasEarlyAccess: true }).price).toBe(79900);
    expect(resolveSalePrice(base, [offer({ phase: 'ENDED' })], { hasEarlyAccess: true }).price).toBe(79900);
    expect(resolveSalePrice(base, [offer({ salePrice: 89900 })], { hasEarlyAccess: true }).price).toBe(79900);
  });
});

describe('pricing engine v2', () => {
  const tee = (qty = 1, extra = {}) => ({ variantId: 'v1', productId: 'p1', categoryIds: ['tees'], unitPrice: 69900, unitMrp: 129900, unitBasePrice: 79900, campaignId: 'c1', quantity: qty, ...extra });
  const buy2 = { id: 'pr1', name: 'Buy 2, extra 10% off', minQuantity: 2, percentOff: 10, maxDiscount: null, categoryIds: ['tees'] };
  const vibe = { code: 'VIBE10', type: 'PERCENTAGE' as const, value: 10, maxDiscount: 30000 };

  it('layers sale price → bundle → coupon → prepaid, with a per-line ledger', () => {
    const r = priceCart({ lines: [tee(2)], promotions: [buy2], coupon: vibe, paymentMethod: 'ONLINE', prepaid: { percent: 5, max: 10000 } });
    expect(r.subtotal).toBe(139800);
    expect(r.campaignSavings).toBe(20000);
    expect(r.promotionDiscount).toBe(13980);
    expect(r.promotion).toEqual({ id: 'pr1', name: 'Buy 2, extra 10% off' });
    expect(r.couponDiscount).toBe(12582);
    expect(r.prepaidDiscount).toBe(5661);
    expect(r.grandTotal).toBe(139800 - 13980 - 12582 - 5661);
    expect(r.lines[0]!.discounts).toEqual({ campaign: 20000, promotion: 13980, coupon: 12582, prepaid: 5661 });
  });

  it('needs the quantity threshold and picks the best promotion', () => {
    expect(priceCart({ lines: [tee(1)], promotions: [buy2] }).promotionDiscount).toBe(0);
    const better = { ...buy2, id: 'pr2', name: 'Buy 2, extra 15%', percentOff: 15 };
    expect(priceCart({ lines: [tee(2)], promotions: [buy2, better] }).promotion!.id).toBe('pr2');
  });

  it('keeps the better offer when a coupon is not combinable, and explains it', () => {
    const flat = { code: 'FLAT100', type: 'FIXED' as const, value: 10000, combinableWithPromotions: false };
    const r = priceCart({ lines: [tee(2)], promotions: [buy2], coupon: flat });
    expect(r.promotionDiscount).toBe(13980);
    expect(r.couponDiscount).toBe(0);
    expect(r.couponError).toMatch(/can't be combined/);
    const big = { ...flat, code: 'FLAT300', value: 30000 };
    const r2 = priceCart({ lines: [tee(2)], promotions: [buy2], coupon: big });
    expect(r2.couponDiscount).toBe(30000);
    expect(r2.promotionDiscount).toBe(0);
    expect(r2.offerNote).toMatch(/saves you more/);
  });

  it('never discounts a line below its floor (e.g. cost price)', () => {
    const r = priceCart({ lines: [tee(2, { unitFloor: 65000 })], promotions: [buy2], coupon: vibe, paymentMethod: 'ONLINE', prepaid: { percent: 5, max: 10000 } });
    expect(r.lines[0]!.taxableValue).toBe(130000); // floor 650 × 2
    expect(r.promotionDiscount + r.couponDiscount + r.prepaidDiscount).toBe(9800);
  });

  it('evaluates coupon minimums after the bundle discount', () => {
    const min = { code: 'MIN1300', type: 'FIXED' as const, value: 5000, minOrderValue: 130000 };
    expect(priceCart({ lines: [tee(2)], promotions: [buy2], coupon: min }).couponError).toMatch(/Add items worth/);
  });
});

describe('bulkSalePrice', () => {
  it('rounds down, optionally to a price ending in 9', async () => {
    const { bulkSalePrice } = await import('./campaigns');
    expect(bulkSalePrice(99900, 30, false)).toBe(69930);
    expect(bulkSalePrice(99900, 30, true)).toBe(69900); // ₹699.30 → ₹699
    expect(bulkSalePrice(100000, 30, true)).toBe(69900); // ₹700 → ₹699
    expect(bulkSalePrice(101900, 30, true)).toBe(70900); // ₹713.30 → ₹709
    expect(bulkSalePrice(900, 50, true)).toBe(400);
  });
});
