import type { CouponType } from './enums';
import type { Paise } from './money';

/**
 * Central commerce pricing rules. The backend is the only authority that
 * applies these to real orders; the frontend may reuse them for previews only.
 */
export const PRICING_RULES = {
  /** Orders with a post-discount subtotal at or above this ship free. */
  freeShippingThreshold: 99_900,
  standardShippingFee: 7_900,
  expressShippingFee: 14_900,
  codFee: 4_900,
  /** Cash on delivery is not offered above this order value. */
  codMaxOrderValue: 500_000,
  /**
   * Indian GST on apparel (GST rationalisation effective 22 Sep 2025):
   * 5% where the per-piece sale value is <= ₹2,500, otherwise 18%.
   * Selling prices are GST-inclusive (as displayed MRP/price in India), so tax
   * is extracted from the price rather than added on top.
   * Verify with your CA before go-live; rates are configuration, not law.
   */
  gstSlabThreshold: 250_000,
  gstLowRate: 5,
  gstHighRate: 18,
} as const;

export type ShippingMethod = 'STANDARD' | 'EXPRESS';

export interface PricingLine {
  variantId: string;
  categoryIds: string[];
  unitPrice: Paise;
  unitMrp: Paise;
  quantity: number;
}

export interface PricingCoupon {
  code: string;
  type: CouponType;
  /** Percentage (0-100) for PERCENTAGE, paise for FIXED. */
  value: number;
  maxDiscount?: Paise | null;
  minOrderValue?: Paise | null;
  /** When non-empty the coupon applies only to lines in these categories. */
  categoryIds?: string[];
}

export interface PricedLine extends PricingLine {
  lineTotal: Paise;
  lineMrpTotal: Paise;
  discountShare: Paise;
  taxableValue: Paise;
  gstRate: number;
  taxAmount: Paise;
}

export interface PricingResult {
  lines: PricedLine[];
  mrpTotal: Paise;
  subtotal: Paise;
  productDiscount: Paise;
  couponDiscount: Paise;
  couponCode: string | null;
  couponError: string | null;
  shippingFee: Paise;
  codFee: Paise;
  taxTotal: Paise;
  grandTotal: Paise;
  codAvailable: boolean;
}

export function gstRateFor(unitNetPrice: Paise): number {
  return unitNetPrice <= PRICING_RULES.gstSlabThreshold ? PRICING_RULES.gstLowRate : PRICING_RULES.gstHighRate;
}

/** Tax contained in a GST-inclusive amount. */
export function inclusiveTax(amount: Paise, ratePercent: number): Paise {
  return Math.round((amount * ratePercent) / (100 + ratePercent));
}

export function evaluateCouponDiscount(
  coupon: PricingCoupon,
  lines: PricingLine[],
): { discount: Paise; error: string | null } {
  const eligible = coupon.categoryIds && coupon.categoryIds.length > 0
    ? lines.filter((l) => l.categoryIds.some((c) => coupon.categoryIds!.includes(c)))
    : lines;
  const eligibleTotal = eligible.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  if (eligibleTotal === 0) return { discount: 0, error: 'Coupon does not apply to items in your bag' };
  if (coupon.minOrderValue && subtotal < coupon.minOrderValue) {
    return { discount: 0, error: `Add items worth ₹${Math.ceil((coupon.minOrderValue - subtotal) / 100)} more to use this coupon` };
  }
  let discount = coupon.type === 'PERCENTAGE'
    ? Math.floor((eligibleTotal * Math.min(Math.max(coupon.value, 0), 100)) / 100)
    : Math.min(coupon.value, eligibleTotal);
  if (coupon.maxDiscount != null) discount = Math.min(discount, coupon.maxDiscount);
  return { discount, error: null };
}

export function priceCart(input: {
  lines: PricingLine[];
  coupon?: PricingCoupon | null;
  shippingMethod?: ShippingMethod;
  paymentMethod?: 'ONLINE' | 'COD';
}): PricingResult {
  const { lines } = input;
  for (const l of lines) {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) throw new Error('Quantity must be a positive integer');
    if (!Number.isInteger(l.unitPrice) || l.unitPrice < 0) throw new Error('Unit price must be integer paise');
  }
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const mrpTotal = lines.reduce((s, l) => s + Math.max(l.unitMrp, l.unitPrice) * l.quantity, 0);

  let couponDiscount = 0;
  let couponError: string | null = null;
  if (input.coupon) {
    const r = evaluateCouponDiscount(input.coupon, lines);
    couponDiscount = r.discount;
    couponError = r.error;
  }

  // Allocate the coupon discount proportionally across eligible lines so per-line
  // taxable values (and therefore GST) are correct. Remainder goes to the last line.
  const eligibleIdx = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => !input.coupon?.categoryIds?.length || l.categoryIds.some((c) => input.coupon!.categoryIds!.includes(c)))
    .map(({ i }) => i);
  const eligibleTotal = eligibleIdx.reduce((s, i) => s + lines[i]!.unitPrice * lines[i]!.quantity, 0);
  const shares = new Array<number>(lines.length).fill(0);
  if (couponDiscount > 0 && eligibleTotal > 0) {
    let allocated = 0;
    eligibleIdx.forEach((i, k) => {
      const lt = lines[i]!.unitPrice * lines[i]!.quantity;
      const share = k === eligibleIdx.length - 1 ? couponDiscount - allocated : Math.floor((couponDiscount * lt) / eligibleTotal);
      shares[i] = share;
      allocated += share;
    });
  }

  const priced: PricedLine[] = lines.map((l, i) => {
    const lineTotal = l.unitPrice * l.quantity;
    const taxableValue = lineTotal - shares[i]!;
    const rate = gstRateFor(Math.round(taxableValue / l.quantity));
    return {
      ...l,
      lineTotal,
      lineMrpTotal: Math.max(l.unitMrp, l.unitPrice) * l.quantity,
      discountShare: shares[i]!,
      taxableValue,
      gstRate: rate,
      taxAmount: inclusiveTax(taxableValue, rate),
    };
  });

  const netSubtotal = subtotal - couponDiscount;
  const method = input.shippingMethod ?? 'STANDARD';
  let shippingFee = 0;
  if (lines.length > 0) {
    if (method === 'EXPRESS') shippingFee = PRICING_RULES.expressShippingFee;
    else shippingFee = netSubtotal >= PRICING_RULES.freeShippingThreshold ? 0 : PRICING_RULES.standardShippingFee;
  }
  const codAvailable = netSubtotal + shippingFee <= PRICING_RULES.codMaxOrderValue;
  const codFee = input.paymentMethod === 'COD' ? PRICING_RULES.codFee : 0;

  return {
    lines: priced,
    mrpTotal,
    subtotal,
    productDiscount: mrpTotal - subtotal,
    couponDiscount,
    couponCode: input.coupon && !couponError ? input.coupon.code : null,
    couponError,
    shippingFee,
    codFee,
    taxTotal: priced.reduce((s, l) => s + l.taxAmount, 0),
    grandTotal: netSubtotal + shippingFee + codFee,
    codAvailable,
  };
}
