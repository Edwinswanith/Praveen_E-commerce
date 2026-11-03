import { describe, expect, it } from 'vitest';
import {
  buildEan13, canTransition, discountPercent, ean13CheckDigit, evaluateCouponDiscount, formatINR,
  generateSku, inclusiveTax, isValidEan13, normalizeScan, parseSearchQuery, priceCart, toPaise, checkoutSchema, variantSchema,
} from './index';

describe('money', () => {
  it('converts without float drift', () => {
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(toPaise('1299.99')).toBe(129999);
    expect(discountPercent(1999, 999)).toBe(50);
    expect(formatINR(1299)).toBe('₹1,299');
  });
});

describe('SKU', () => {
  it('builds a deterministic variant SKU', () => {
    expect(generateSku({ categoryCode: 'TSH', productSeq: 42, color: 'Black', size: 'm' })).toBe('VY-TSH-00042-BLK-M');
    expect(generateSku({ categoryCode: 'JNS', productSeq: 7, color: 'Indigo Wash', size: '32' })).toBe('VY-JNS-00007-IND-32');
  });
  it('rejects invalid sequence', () => {
    expect(() => generateSku({ categoryCode: 'TSH', productSeq: 0, color: 'Black', size: 'M' })).toThrow();
  });
});

describe('EAN-13', () => {
  it('computes known check digits', () => {
    expect(ean13CheckDigit('400638133393')).toBe(1); // 4006381333931 is a well-known valid EAN
    expect(isValidEan13('4006381333931')).toBe(true);
    expect(isValidEan13('4006381333932')).toBe(false);
  });
  it('builds restricted-circulation internal codes', () => {
    const c = buildEan13('20', 123);
    expect(c).toHaveLength(13);
    expect(c.startsWith('200000000123')).toBe(true);
    expect(isValidEan13(c)).toBe(true);
  });
  it('reads SKUs from tag links and legacy QR text', async () => {
    const { skuFromTagPayload } = await import('./index');
    expect(skuFromTagPayload('https://vyra.in/s/VY-TSH-00042-BLK-M?utm_source=tag')).toBe('VY-TSH-00042-BLK-M');
    expect(skuFromTagPayload('VYRA:vy-tsh-00042-blk-m')).toBe('VY-TSH-00042-BLK-M');
    expect(skuFromTagPayload('2000000000251')).toBeNull();
  });
  it('strips scanner noise', () => {
    expect(normalizeScan(']E02000000001234\r\n')).toBe('2000000001234');
  });
});

describe('pricing', () => {
  const line = (price: number, qty = 1, cats = ['c1']) => ({ variantId: 'v' + price, categoryIds: cats, unitPrice: price, unitMrp: price * 2, quantity: qty });

  it('charges shipping below threshold and frees it above', () => {
    expect(priceCart({ lines: [line(50000)] }).shippingFee).toBe(7900);
    expect(priceCart({ lines: [line(50000, 2)] }).shippingFee).toBe(0);
    expect(priceCart({ lines: [] }).grandTotal).toBe(0);
  });

  it('extracts inclusive GST by slab', () => {
    expect(inclusiveTax(105000, 5)).toBe(5000);
    const r = priceCart({ lines: [line(105000), line(354000)] });
    expect(r.lines[0]!.gstRate).toBe(5);
    expect(r.lines[1]!.gstRate).toBe(18);
    expect(r.taxTotal).toBe(5000 + 54000);
  });

  it('applies percentage coupon with cap and allocates exactly', () => {
    const coupon = { code: 'VIBE10', type: 'PERCENTAGE' as const, value: 10, maxDiscount: 15000 };
    const r = priceCart({ lines: [line(99900), line(99900)], coupon });
    expect(r.couponDiscount).toBe(15000);
    expect(r.lines.reduce((s, l) => s + l.discountShare, 0)).toBe(15000);
    expect(r.grandTotal).toBe(199800 - 15000);
  });

  it('enforces min order value and category scope', () => {
    expect(evaluateCouponDiscount({ code: 'X', type: 'FIXED', value: 20000, minOrderValue: 200000 }, [line(100000)]).error).toMatch(/Add items/);
    expect(evaluateCouponDiscount({ code: 'X', type: 'FIXED', value: 20000, categoryIds: ['other'] }, [line(100000)]).error).toMatch(/does not apply/);
    expect(evaluateCouponDiscount({ code: 'X', type: 'FIXED', value: 999999 }, [line(100000)]).discount).toBe(100000);
  });

  it('adds COD fee and blocks COD above limit', () => {
    expect(priceCart({ lines: [line(100000)], paymentMethod: 'COD' }).codFee).toBe(4900);
    expect(priceCart({ lines: [line(600000)] }).codAvailable).toBe(false);
  });

  it('rejects fractional quantity', () => {
    expect(() => priceCart({ lines: [line(100, 1.5)] })).toThrow();
  });
});

describe('deal claims', () => {
  it('never claims more than the best purchasable discount', async () => {
    const { upToDiscountClaim } = await import('./index');
    expect(upToDiscountClaim(47)).toBe(45);
    expect(upToDiscountClaim(60)).toBe(60);
    expect(upToDiscountClaim(9)).toBeNull();
    expect(upToDiscountClaim(0)).toBeNull();
  });
});

describe('order transitions', () => {
  it('allows the happy path and blocks skips', () => {
    expect(canTransition('PENDING_PAYMENT', 'CONFIRMED')).toBe(true);
    expect(canTransition('CONFIRMED', 'DELIVERED')).toBe(false);
    expect(canTransition('DELIVERED', 'CANCELLED')).toBe(false);
    expect(canTransition('CANCELLED', 'CONFIRMED')).toBe(false);
  });
});

describe('search query parser', () => {
  it('extracts structured constraints', () => {
    const p = parseSearchQuery('Find a comfortable oversized black cotton T-shirt for summer under 1000 rupees');
    expect(p.maxPrice).toBe(1000);
    expect(p.colors).toEqual(['black']);
    expect(p.semanticText).toContain('oversized');
    expect(p.semanticText).toContain('cotton');
    expect(p.semanticText).not.toContain('black');
  });
  it('handles ranges, k-suffix and gender', () => {
    const p = parseSearchQuery("women's kurta between 1k and 2,500");
    expect(p.gender).toBe('WOMEN');
    expect(p.minPrice).toBe(1000);
    expect(p.maxPrice).toBe(2500);
  });
});

describe('validation schemas', () => {
  it('rejects price above MRP', () => {
    expect(variantSchema.safeParse({ color: 'Black', size: 'M', mrp: 100, price: 200 }).success).toBe(false);
  });
  it('requires an address at checkout', () => {
    expect(checkoutSchema.safeParse({ paymentMethod: 'COD', idempotencyKey: crypto.randomUUID() }).success).toBe(false);
  });
});

describe('prepaid discount & COD', () => {
  const line = (price: number, qty = 1) => ({ variantId: 'v' + price, categoryIds: ['c1'], unitPrice: price, unitMrp: price * 2, quantity: qty });

  it('gives online payers 5% (capped) and allocates it into taxable values', () => {
    const r = priceCart({ lines: [line(100000), line(50000)], paymentMethod: 'ONLINE' });
    expect(r.prepaidDiscount).toBe(7500);
    expect(r.grandTotal).toBe(150000 - 7500);
    expect(r.lines.reduce((s, l) => s + l.discountShare, 0)).toBe(7500);
    expect(priceCart({ lines: [line(400000)], paymentMethod: 'ONLINE' }).prepaidDiscount).toBe(10000); // cap ₹100
    expect(priceCart({ lines: [line(100000)], paymentMethod: 'COD' }).prepaidDiscount).toBe(0);
    expect(priceCart({ lines: [line(100000)], paymentMethod: 'ONLINE', prepaid: { percent: 0, max: 0 } }).prepaidDiscount).toBe(0);
  });

  it('stacks after the coupon and never costs free shipping', () => {
    const coupon = { code: 'X', type: 'FIXED' as const, value: 10000 };
    const r = priceCart({ lines: [line(110000)], coupon, paymentMethod: 'ONLINE' });
    expect(r.couponDiscount).toBe(10000);
    expect(r.prepaidDiscount).toBe(5000); // 5% of 1000
    expect(r.shippingFee).toBe(0); // 1000 after coupon qualifies even though 950 after prepaid
  });

  it('lets shipped parcels go RTO but not delivered ones', () => {
    expect(canTransition('SHIPPED', 'RTO')).toBe(true);
    expect(canTransition('OUT_FOR_DELIVERY', 'RTO')).toBe(true);
    expect(canTransition('DELIVERED', 'RTO')).toBe(false);
  });
});

describe('phone schema', () => {
  it('normalises Indian mobile formats', async () => {
    const { indianMobileSchema } = await import('./index');
    expect(indianMobileSchema.parse('+91 98765-43210')).toBe('9876543210');
    expect(indianMobileSchema.parse('09876543210')).toBe('9876543210');
    expect(indianMobileSchema.safeParse('1234567890').success).toBe(false);
  });
});
